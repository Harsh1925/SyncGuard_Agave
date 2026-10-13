import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import { z } from 'zod';
import type { Settings } from '../config.js';
import { RedisSupport } from '../state/redis.js';
import { ERPAdapter } from '../adapters/erp.js';
import { PMAdapter } from '../adapters/pm.js';
import { SnapshotDetector } from '../engine/detector.js';
import { SyncWorker } from '../engine/worker.js';
import { Reconciler } from '../engine/reconciler.js';
import { normalizeInvoice, logicalId } from '../domain/invoice.js';
import { plan, pendingResults } from './planner.js';
import { demoEnabled, setFault } from './simulator.js';
import { faultPoints } from './faults.js';
import { childCommand } from './process.js';
export const chaosRequestSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffffffff),
    steps: z.number().int().min(1).max(40).default(12),
    fault_point: z.enum(faultPoints).optional(),
  })
  .strict();
export async function createChaos(pool: pg.Pool, input: z.infer<typeof chaosRequestSchema>) {
  const id = randomUUID();
  const sequence = plan(input.seed, input.steps);
  await pool.query(
    `INSERT INTO chaos_runs(id,seed,configuration,failure_sequence,invariant_results)
    VALUES ($1,$2,$3,$4,$5)`,
    [
      id,
      input.seed,
      JSON.stringify({ ...input, kind: 'seeded-chaos' }),
      JSON.stringify(sequence),
      JSON.stringify(pendingResults()),
    ],
  );
  return id;
}
export async function runChaos(
  pool: pg.Pool,
  settings: Settings,
  redis: RedisSupport,
  rawId: unknown,
) {
  if (!demoEnabled(settings.DATABASE_URL))
    throw new Error('Chaos execution requires isolated demo controls');
  const id = z.string().uuid().parse(rawId);
  const run = (await pool.query('SELECT * FROM chaos_runs WHERE id=$1', [id])).rows[0];
  if (!run || run.configuration.kind !== 'seeded-chaos')
    throw new Error('Executable run not found');
  if (run.status !== 'planned') throw new Error('Run has already been executed');
  const lock = await pool.connect();
  const acquired = (await lock.query('SELECT pg_try_advisory_lock(91003) AS locked')).rows[0]
    .locked;
  if (!acquired) {
    lock.release();
    await pool.query(
      "UPDATE chaos_runs SET status='failed',completed_at=now(),operation_counts=$2 WHERE id=$1",
      [id, JSON.stringify({ error: 'Another demo or chaos run owns the environment' })],
    );
    throw new Error('Demo environment is busy');
  }
  const erp = new ERPAdapter(pool, true);
  const pm = new PMAdapter(settings.PM_URL);
  const detector = new SnapshotDetector(pool, erp, redis);
  const worker = () => new SyncWorker(pool, { ...settings, LEASE_SECONDS: 1 }, pm, redis);
  const evidence: { fault: string; passed: boolean; detail: unknown }[] = [];
  const invoice = normalizeInvoice({
    company_id: 'ACME',
    vendor_id: 'V001',
    invoice_number: `CHAOS-${id.slice(0, 8)}`,
    job_id: 'J001',
    amount: '100.00',
    currency: 'USD',
    issued_on: '2026-01-15',
    status: 'open',
  });
  const key = logicalId(invoice);
  async function drain() {
    for (let i = 0; i < 150; i++) {
      await worker().runOnce();
      if (
        !(
          await pool.query(
            "SELECT 1 FROM jobs WHERE status IN ('pending','claimed','retrying') LIMIT 1",
          )
        ).rowCount
      )
        return;
      await sleep(100);
    }
    throw new Error('Queue did not converge within deadline');
  }
  const op = async (operation: string) =>
    (await pool.query('SELECT * FROM operations WHERE operation_id=$1', [operation])).rows[0];
  let amount = 100;
  async function pending() {
    amount++;
    await pool.query('UPDATE erp_sim."AP_INV" SET "GROSS_AMT"=$1 WHERE "INV_NO"=$2', [
      `${amount}.00`,
      invoice.invoice_number,
    ]);
    const result = await detector.run();
    assert.equal(result.operations.length, 1);
    return result.operations[0];
  }
  async function save(fault: string, detail: unknown) {
    evidence.push({ fault, passed: true, detail });
    await pool.query('UPDATE chaos_runs SET operation_counts=$2 WHERE id=$1', [
      id,
      JSON.stringify({ evidence }),
    ]);
    console.log(`PASS ${fault}: ${JSON.stringify(detail)}`);
  }
  try {
    assert.equal(run.status, 'planned');
    await pool.query("UPDATE chaos_runs SET status='running' WHERE id=$1", [id]);
    await setFault(pool, { target: 'erp', kind: 'none', remaining: 0 });
    await setFault(pool, { target: 'pm', kind: 'none', remaining: 0 });
    await detector.run();
    await drain();
    await pool.query('INSERT INTO erp_sim."AP_INV" VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      invoice.company_id,
      invoice.vendor_id,
      invoice.invoice_number,
      invoice.job_id,
      invoice.amount,
      invoice.currency,
      invoice.issued_on,
      'O',
    ]);
    await detector.run();
    await drain();
    // Always prove each critical boundary, independently of the seeded random choices.
    for (const point of run.configuration.fault_point
      ? [run.configuration.fault_point]
      : faultPoints) {
      let operation: string | undefined;
      let command = 'worker-once';
      if (point === 'DURING_SNAPSHOT' || point === 'AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT')
        command = 'poll';
      else if (point === 'DURING_RECONCILIATION') command = 'reconcile';
      else operation = await pending();
      assert.equal(await childCommand(settings, command, point), 86);
      if (operation) {
        if (point === 'AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION') {
          assert.equal((await op(operation)).status, 'attempting');
          assert.equal((await pm.get(key))?.invoice.amount, `${amount}.00`);
        }
        await sleep(1200);
        await drain();
        if (point === 'AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION')
          assert.equal((await op(operation)).verification_outcome, 'already_committed');
      } else if (command === 'poll') {
        await detector.run();
        await drain();
        assert.equal(
          (await pool.query("SELECT 1 FROM snapshots WHERE status='IN_PROGRESS'")).rowCount,
          0,
        );
      } else await new Reconciler(pool, erp, pm).run();
      await save(point, { operation_id: operation ?? null, exit_code: 86 });
    }
    for (const step of run.failure_sequence as { step: number; fault: string }[]) {
      if (step.fault === 'incomplete_snapshot') {
        const before = (
          await pool.query("SELECT count(*)::int AS n FROM operations WHERE action='delete'")
        ).rows[0].n;
        await setFault(pool, { target: 'erp', kind: 'partial_read', fail_after: 1 });
        await assert.rejects(detector.run(), /partial ERP read/);
        assert.equal(
          (await pool.query("SELECT count(*)::int AS n FROM operations WHERE action='delete'"))
            .rows[0].n,
          before,
        );
        await save(step.fault, { step: step.step, false_deletes: 0 });
        continue;
      }
      const operation = await pending();
      const current = await op(operation);
      if (['lost_response', 'transient_failure', 'rate_limit'].includes(step.fault)) {
        await setFault(pool, { target: 'pm', kind: step.fault });
        await worker().runOnce();
        assert.equal((await op(operation)).status, 'retrying');
        await drain();
        if (step.fault === 'lost_response')
          assert.equal((await op(operation)).verification_outcome, 'already_committed');
      } else if (step.fault === 'duplicate_delivery' || step.fault === 'concurrent_delivery') {
        await pool.query('INSERT INTO jobs(operation_id) SELECT $1 FROM generate_series(1,9)', [
          operation,
        ]);
        if (step.fault === 'concurrent_delivery')
          assert.deepEqual(
            await Promise.all([
              childCommand(settings, 'worker-once'),
              childCommand(settings, 'worker-once'),
            ]),
            [0, 0],
          );
        await drain();
      } else if (step.fault === 'crash_after_commit') {
        assert.equal(
          await childCommand(
            settings,
            'worker-once',
            'AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION',
          ),
          86,
        );
        await sleep(1200);
        await drain();
        assert.equal((await op(operation)).verification_outcome, 'already_committed');
      } else if (step.fault === 'out_of_order') {
        const newer = await pending();
        // Reverse availability so the full newer state is delivered first.
        await pool.query(
          "UPDATE jobs SET available_at=now()+interval '1 second' WHERE operation_id=$1",
          [operation],
        );
        await worker().runOnce();
        await drain();
        assert.equal((await op(operation)).status, 'suppressed');
        assert.equal((await op(newer)).status, 'succeeded');
        assert.equal((await pm.get(key))?.invoice.amount, `${amount}.00`);
      }
      assert.equal((await pm.get(key))?.invoice.amount, `${amount}.00`);
      const receiptCount = (
        await pool.query('SELECT count(*)::int AS n FROM pm_sim.receipts WHERE operation_id=$1', [
          operation,
        ])
      ).rows[0].n;
      assert.equal(
        receiptCount,
        current.status === 'suppressed' || step.fault === 'out_of_order' ? 0 : 1,
      );
      await save(step.fault, { step: step.step, operation_id: operation, receipts: receiptCount });
    }
    const direct = await fetch(`${settings.PM_URL}/invoices/${key}/direct-edit`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...invoice, amount: '9999.00' }),
    });
    assert.ok(direct.ok);
    assert.ok((await new Reconciler(pool, erp, pm).run()).drift.includes(key));
    await pending();
    await drain();
    assert.ok(!(await new Reconciler(pool, erp, pm).run()).drift.includes(key));
    const old = (await pm.get(key))!;
    await pool.query('DELETE FROM erp_sim."AP_INV" WHERE "INV_NO"=$1', [invoice.invoice_number]);
    await detector.run();
    await drain();
    const stale = await fetch(`${settings.PM_URL}/invoices/${key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: randomUUID(),
        version: old.version,
        action: 'upsert',
        invoice: old.invoice,
      }),
    });
    assert.equal(stale.status, 409);
    assert.equal(await pm.get(key), null);
    assert.equal(
      (await pool.query("SELECT 1 FROM operations WHERE status NOT IN ('succeeded','suppressed')"))
        .rowCount,
      0,
    );
    assert.equal((await new Reconciler(pool, erp, pm).run()).drift.length, 0);
    const counts = (
      await pool.query(
        'SELECT status,count(*)::int AS count FROM operations WHERE logical_id=$1 GROUP BY status',
        [key],
      )
    ).rows;
    const invariants = pendingResults().map((result) => ({
      ...result,
      passed: true,
      evidence: `Executed run ${id}: receipts, queue completion, stale suppression/tombstone, failed snapshot and drift/reconvergence assertions passed`,
    }));
    await pool.query(
      "UPDATE chaos_runs SET status='completed',completed_at=now(),operation_counts=$2,invariant_results=$3 WHERE id=$1",
      [id, JSON.stringify({ counts, evidence }), JSON.stringify(invariants)],
    );
  } catch (error) {
    await pool.query(
      "UPDATE chaos_runs SET status='failed',completed_at=now(),operation_counts=$2 WHERE id=$1",
      [id, JSON.stringify({ evidence, error: String(error) })],
    );
    throw error;
  } finally {
    await setFault(pool, { target: 'erp', kind: 'none', remaining: 0 });
    await setFault(pool, { target: 'pm', kind: 'none', remaining: 0 });
    await lock.query('SELECT pg_advisory_unlock(91003)');
    lock.release(true);
  }
}
