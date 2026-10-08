import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, migrate, transaction } from '../src/state/database.js';
import { enqueueChange, claim } from '../src/state/repository.js';
import { RedisSupport } from '../src/state/redis.js';
import { SnapshotDetector } from '../src/engine/detector.js';
import { SyncWorker } from '../src/engine/worker.js';
import { ERPAdapter } from '../src/adapters/erp.js';
import { buildPM } from '../src/simulators/pm.js';
import { seed } from '../src/simulators/erp.js';
import { loadSettings } from '../src/config.js';
import { normalizeInvoice, logicalId, fingerprint } from '../src/domain/invoice.js';
const invoice = normalizeInvoice({
  company_id: 'ACME',
  vendor_id: 'V001',
  invoice_number: 'INV-1001',
  job_id: 'J001',
  amount: '1250.00',
  currency: 'USD',
  issued_on: '2026-01-15',
});
describe.skipIf(!process.env.TEST_DATABASE_URL)('Postgres durability integration', () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!);
  const redis = new RedisSupport();
  beforeEach(async () => {
    await migrate(pool);
    await pool.query(
      'TRUNCATE audit_events,jobs,operations,snapshot_members,snapshots,records,drift_reports,chaos_runs,pm_sim.receipts,pm_sim.invoices,erp_sim."AP_INV",erp_sim."AP_VND",erp_sim.initialization CASCADE',
    );
  });
  afterAll(async () => pool.end());
  const enqueue = () =>
    transaction(pool, (client) =>
      enqueueChange(client, {
        logicalId: logicalId(invoice),
        action: 'upsert',
        desired: invoice,
        fingerprint: fingerprint(invoice),
      }),
    );
  it('failed snapshots cannot derive deletes', async () => {
    await seed(pool);
    await new SnapshotDetector(pool, new ERPAdapter(pool), redis).run();
    await expect(
      new SnapshotDetector(
        pool,
        {
          snapshot: async () => {
            throw new Error('Incomplete read');
          },
        },
        redis,
      ).run(),
    ).rejects.toThrow('Incomplete read');
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM operations WHERE action='delete'")).rows[0]
        .n,
    ).toBe(0);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM snapshots WHERE status='FAILED'")).rows[0]
        .n,
    ).toBe(1);
  });
  it('expired claims can be reclaimed with a new claim token', async () => {
    await enqueue();
    const first = await transaction(pool, (client) => claim(client, 'a', 1));
    await pool.query("UPDATE jobs SET lease_until=now()-interval '1 second'");
    const second = await transaction(pool, (client) => claim(client, 'b', 1));
    expect(second!.id).toBe(first!.id);
    expect(second!.claim_token).not.toBe(first!.claim_token);
  });
  it('lost response plus duplicate delivery produces one write', async () => {
    let committed = false;
    let writes = 0;
    const op = await enqueue();
    await pool.query('INSERT INTO jobs(operation_id) VALUES ($1)', [op]);
    const destination = {
      verify: async () => committed,
      write: async () => {
        writes++;
        committed = true;
        throw new Error('Lost response after commit');
      },
    };
    const worker = new SyncWorker(pool, loadSettings({}), destination, redis);
    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(true);
    await pool.query("UPDATE jobs SET available_at=now() WHERE status='retrying'");
    expect(await worker.runOnce()).toBe(true);
    expect(writes).toBe(1);
    expect(
      (await pool.query('SELECT status FROM operations WHERE operation_id=$1', [op])).rows[0]
        .status,
    ).toBe('succeeded');
  });
  it('bootstrap preserves deliberate source deletion', async () => {
    await seed(pool);
    await pool.query('DELETE FROM erp_sim."AP_INV"');
    await seed(pool);
    expect((await pool.query('SELECT count(*)::int AS n FROM erp_sim."AP_INV"')).rows[0].n).toBe(0);
  });
  it('ERP business uniqueness prevents a second financial invoice', async () => {
    await seed(pool);
    await expect(
      pool.query('INSERT INTO erp_sim."AP_INV" SELECT * FROM erp_sim."AP_INV"'),
    ).rejects.toMatchObject({ code: '23505' });
  });
  it('PM receipts deduplicate and tombstones fence stale writes', async () => {
    const app = await buildPM(pool, redis);
    const id = logicalId(invoice);
    const op = await enqueue();
    const payload = { operation_id: op, version: '43', action: 'upsert', invoice };
    expect((await app.inject({ method: 'PUT', url: `/invoices/${id}`, payload })).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject({ method: 'PUT', url: `/invoices/${id}`, payload })).json().duplicate,
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/invoices/${id}`,
          payload: {
            operation_id: '00000000-0000-4000-8000-000000000001',
            version: '44',
            action: 'delete',
            invoice: null,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/invoices/${id}`,
          payload: { ...payload, operation_id: '00000000-0000-4000-8000-000000000002' },
        })
      ).statusCode,
    ).toBe(409);
    expect((await app.inject(`/invoices/${id}`)).statusCode).toBe(404);
    await app.close();
  });
});
describe.skipIf(!process.env.TEST_REDIS_URL)('Redis integration', () => {
  it('caches with TTL and atomically enforces a rate window', async () => {
    const redis = new RedisSupport();
    await redis.connect(process.env.TEST_REDIS_URL!);
    expect(redis.ready).toBe(true);
    const key = `syncguard:test:${Date.now()}`;
    await redis.cache(key, { ok: true }, 1);
    expect(await redis.get(key)).toEqual({ ok: true });
    expect(await redis.allow(`${key}:rate`, 1, 1)).toBe(true);
    expect(await redis.allow(`${key}:rate`, 1, 1)).toBe(false);
    await redis.close();
  });
});
