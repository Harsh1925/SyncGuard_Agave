import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import type { Settings } from '../config.js';
import { ERPAdapter } from '../adapters/erp.js';
import { PMAdapter } from '../adapters/pm.js';
import { normalizeInvoice, logicalId } from '../domain/invoice.js';
import { SnapshotDetector } from '../engine/detector.js';
import { Reconciler } from '../engine/reconciler.js';
import { SyncWorker } from '../engine/worker.js';
import { RedisSupport } from '../state/redis.js';
import { plan } from '../chaos/planner.js';

// The runner is intentionally unavailable against the normal application database.
export async function runDemo(pool: pg.Pool, settings: Settings, redis: RedisSupport, seed = 42) {
  assert.equal(
    new URL(settings.DATABASE_URL).pathname,
    '/syncguard_demo',
    'Demo requires the separate syncguard_demo database',
  );
  const sequence = plan(seed, 1); // Validates seed; this is a scripted proof, not random chaos.
  const client = await pool.connect();
  const locked = (await client.query('SELECT pg_try_advisory_lock(91003) AS locked')).rows[0]
    .locked;
  if (!locked) {
    client.release();
    throw new Error('Another demo is already running');
  }
  const runId = randomUUID();
  const evidence: { scenario: string; passed: boolean; detail: unknown }[] = [];
  const invoice = normalizeInvoice({
    company_id: 'ACME',
    vendor_id: 'V001',
    invoice_number: `DEMO-${runId.slice(0, 8)}`,
    job_id: 'J001',
    amount: `${1250 + (seed % 1000)}.00`,
    currency: 'USD',
    issued_on: '2026-01-15',
    status: 'open',
  });
  const id = logicalId(invoice);
  const erp = new ERPAdapter(pool);
  const pm = new PMAdapter(settings.PM_URL);
  const detector = new SnapshotDetector(pool, erp, redis);
  const worker = () => new SyncWorker(pool, { ...settings, LEASE_SECONDS: 1 }, pm, redis);
  const record = (scenario: string, detail: unknown) => {
    evidence.push({ scenario, passed: true, detail });
    console.log(`PASS ${scenario}: ${JSON.stringify(detail)}`);
  };
  async function drain() {
    for (let attempt = 0; attempt < 80; attempt++) {
      await Promise.all([worker().runOnce(), worker().runOnce()]);
      const outstanding = (
        await pool.query(
          "SELECT count(*)::int AS n FROM jobs WHERE status IN ('pending','claimed','retrying')",
        )
      ).rows[0].n;
      if (!outstanding) return;
      await sleep(100);
    }
    throw new Error('Queue did not settle within the demo deadline');
  }
  const operation = async (op: string) =>
    (await pool.query('SELECT * FROM operations WHERE operation_id=$1', [op])).rows[0];
  try {
    await pool.query(
      `INSERT INTO chaos_runs(id,seed,configuration,failure_sequence,status)
      VALUES ($1,$2,$3,$4,'running')`,
      [
        runId,
        seed,
        JSON.stringify({
          kind: 'scripted-demo',
          logical_id: id,
          invoice,
          planned_sample: sequence,
        }),
        '[]',
      ],
    );
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
    const create = (await detector.run()).operations[0];
    assert.ok(create);
    // Ten deliveries of the same operation, with two independent worker instances.
    await pool.query('INSERT INTO jobs(operation_id) SELECT $1 FROM generate_series(1,9)', [
      create,
    ]);
    await drain();
    assert.equal((await pm.get(id))?.invoice.amount, invoice.amount);
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS n FROM pm_sim.receipts WHERE operation_id=$1', [
          create,
        ])
      ).rows[0].n,
      1,
    );
    record('create + ten deliveries + concurrent worker instances', {
      operation_id: create,
      receipts: 1,
    });
    await pool.query('UPDATE erp_sim."AP_INV" SET "GROSS_AMT"=$1 WHERE "INV_NO"=$2', [
      '2499.00',
      invoice.invoice_number,
    ]);
    const update = (await detector.run()).operations[0];
    assert.ok(update);
    const defer = await new Reconciler(pool, erp, pm).run();
    assert.ok(defer.deferred.includes(id));
    assert.ok(!defer.drift.includes(id));
    record('reconciliation defers pending sync', { logical_id: id });
    // Start a real child process. Exit 86 occurs only after the HTTP destination write.
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('../cli.ts', import.meta.url)), 'worker-once'],
        {
          env: {
            ...process.env,
            DATABASE_URL: settings.DATABASE_URL,
            PM_URL: settings.PM_URL,
            LEASE_SECONDS: '1',
            ENABLE_FAULTS: 'true',
            FAULT_POINT: 'AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION',
          },
          stdio: 'inherit',
        },
      );
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Crash child timed out'));
      }, 15000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
    assert.equal(code, 86);
    assert.equal((await operation(update)).status, 'attempting');
    assert.equal((await pm.get(id))?.invoice.amount, '2499.00');
    await sleep(1200);
    await drain();
    assert.equal((await operation(update)).verification_outcome, 'already_committed');
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS n FROM pm_sim.receipts WHERE operation_id=$1', [
          update,
        ])
      ).rows[0].n,
      1,
    );
    record('crash after external commit + lease recovery', {
      operation_id: update,
      exit_code: code,
      verification: 'already_committed',
      receipts: 1,
    });
    const deletesBefore = (
      await pool.query("SELECT count(*)::int AS n FROM operations WHERE action='delete'")
    ).rows[0].n;
    await assert.rejects(
      new SnapshotDetector(
        pool,
        {
          snapshot: async () => {
            await erp.snapshot();
            throw new Error('Injected failure before full snapshot acceptance');
          },
        },
        redis,
      ).run(),
      /Injected failure/,
    );
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM operations WHERE action='delete'")).rows[0]
        .n,
      deletesBefore,
    );
    record('failed observation creates zero false deletes', { deletes_derived: 0 });
    const driftResponse = await fetch(`${settings.PM_URL}/invoices/${id}/direct-edit`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...invoice, amount: '9999.00' }),
    });
    assert.ok(driftResponse.ok);
    assert.ok((await new Reconciler(pool, erp, pm).run()).drift.includes(id));
    record('manual replica edit detected as drift', { logical_id: id, replica_amount: '9999.00' });
    // Restore through a NEW authoritative ERP observation, not an unimplemented repair.
    await pool.query('UPDATE erp_sim."AP_INV" SET "GROSS_AMT"=2500 WHERE "INV_NO"=$1', [
      invoice.invoice_number,
    ]);
    await detector.run();
    await drain();
    assert.ok(!(await new Reconciler(pool, erp, pm).run()).drift.includes(id));
    record('new authoritative update restores convergence', { amount: '2500.00' });
    await pool.query('DELETE FROM erp_sim."AP_INV" WHERE "INV_NO"=$1', [invoice.invoice_number]);
    const deletion = (await detector.run()).operations[0];
    assert.ok(deletion);
    await drain();
    assert.equal(await pm.get(id), null);
    const older = await operation(update);
    const stale = await fetch(`${settings.PM_URL}/invoices/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: randomUUID(),
        version: String(older.version),
        action: 'upsert',
        invoice: older.desired,
      }),
    });
    assert.equal(stale.status, 409);
    assert.equal(await pm.get(id), null);
    record('delete tombstone rejects delayed older update', {
      operation_id: deletion,
      stale_http_status: 409,
    });
    const counts = (
      await pool.query('SELECT status,count(*)::int AS count FROM operations GROUP BY status')
    ).rows;
    assert.ok(counts.every((row) => ['succeeded', 'suppressed'].includes(row.status)));
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM jobs WHERE status <> 'succeeded'")).rows[0]
        .n,
      0,
    );
    assert.equal((await new Reconciler(pool, erp, pm).run()).drift.length, 0);
    const invariants = [
      'idempotent_financial_effect',
      'no_silent_loss',
      'monotonic_record_state',
      'safe_observation',
      'observable_convergence',
    ].map((name) => ({
      name,
      passed: true,
      evidence: `Bounded scripted demo ${runId}; see recorded scenario assertions`,
    }));
    await pool.query(
      `UPDATE chaos_runs SET status='completed',completed_at=now(),failure_sequence=$2,
      operation_counts=$3,invariant_results=$4 WHERE id=$1`,
      [runId, JSON.stringify(evidence), JSON.stringify(counts), JSON.stringify(invariants)],
    );
    console.log(
      JSON.stringify(
        {
          run_id: runId,
          seed,
          kind: 'scripted-demo',
          status: 'completed',
          scenarios: evidence,
          invariants,
          note: 'These assertions prove only the recorded scenarios, not production reliability.',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await pool.query(
      "UPDATE chaos_runs SET status='failed',completed_at=now(),failure_sequence=$2 WHERE id=$1",
      [runId, JSON.stringify([...evidence, { passed: false, error: String(error) }])],
    );
    throw error;
  } finally {
    await client.query('SELECT pg_advisory_unlock(91003)');
    client.release(true);
  }
}
