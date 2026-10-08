import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { Metrics } from '@syncguard/contracts';
import type { Settings } from '../config.js';
import { server } from './server.js';
import { ERPAdapter } from '../adapters/erp.js';
import { PMAdapter } from '../adapters/pm.js';
import { SnapshotDetector } from '../engine/detector.js';
import { Reconciler } from '../engine/reconciler.js';
import { RedisSupport } from '../state/redis.js';
import { transaction } from '../state/database.js';
import { audit } from '../state/repository.js';
import { plan, pendingResults } from '../chaos/planner.js';

export async function buildApi(pool: pg.Pool, settings: Settings, redis: RedisSupport) {
  if (settings.ENABLE_FAULTS === 'true')
    throw new Error('Fault hooks must run in disposable CLI processes, not the API');
  const app = await server('SyncGuard');
  const erp = new ERPAdapter(pool);
  const pm = new PMAdapter(settings.PM_URL);
  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok', redis: redis.ready ? 'ok' : 'degraded' };
  });
  app.get('/metrics', async () => {
    const cached = await redis.get<Metrics>('syncguard:metrics');
    if (cached) return cached;
    const [counts, snapshot, sync, drift, lag] = await Promise.all([
      pool.query('SELECT status,count(*)::int AS count FROM jobs GROUP BY status'),
      pool.query(
        "SELECT completed_at FROM snapshots WHERE status='COMPLETE' ORDER BY completed_at DESC LIMIT 1",
      ),
      pool.query(
        "SELECT max(completed_at) AS completed_at FROM operations WHERE status='succeeded'",
      ),
      pool.query('SELECT count(*)::int AS count FROM drift_reports WHERE resolved_at IS NULL'),
      pool.query(
        "SELECT EXTRACT(epoch FROM now()-min(created_at)) AS seconds FROM jobs WHERE status IN ('pending','claimed','retrying')",
      ),
    ]);
    const [erpHealth, pmHealth] = await Promise.all([
      pool.query('SELECT 1 FROM erp_sim."AP_INV" LIMIT 1').then(
        () => 'ok',
        () => 'unavailable',
      ),
      fetch(`${settings.PM_URL}/health`, { signal: AbortSignal.timeout(2000) }).then(
        (response) => (response.ok ? 'ok' : 'unavailable'),
        () => 'unavailable',
      ),
    ]);
    const result: Metrics = {
      jobs: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])),
      erp: erpHealth,
      pm: pmHealth,
      redis: redis.ready ? 'ok' : 'degraded',
      last_complete_snapshot: snapshot.rows[0]?.completed_at?.toISOString() ?? null,
      last_successful_sync: sync.rows[0].completed_at?.toISOString() ?? null,
      drift_count: drift.rows[0].count,
      sync_lag_seconds: Number(lag.rows[0].seconds ?? 0),
    };
    await redis.cache('syncguard:metrics', result, 3);
    return result;
  });
  app.get<{ Querystring: { limit?: string } }>('/operations', async (request) => {
    const limit = z.coerce.number().int().min(1).max(100).default(25).parse(request.query.limit);
    return (
      await pool.query(
        'SELECT * FROM operations ORDER BY created_at DESC,operation_id DESC LIMIT $1',
        [limit],
      )
    ).rows;
  });
  app.get<{ Params: { id: string } }>('/operations/:id', async (request, reply) => {
    const id = z.string().uuid().parse(request.params.id);
    const row = (await pool.query('SELECT * FROM operations WHERE operation_id=$1', [id])).rows[0];
    return row ?? reply.code(404).send({ detail: 'Operation not found' });
  });
  app.get<{ Params: { id: string }; Querystring: { after?: string; limit?: string } }>(
    '/operations/:id/timeline',
    async (request) => {
      const id = z.string().uuid().parse(request.params.id);
      const query = z
        .object({
          after: z.string().regex(/^\d+$/).default('0'),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        })
        .parse(request.query);
      return (
        await pool.query(
          'SELECT * FROM audit_events WHERE operation_id=$1 AND id>$2 ORDER BY id LIMIT $3',
          [id, query.after, query.limit],
        )
      ).rows;
    },
  );
  app.post<{ Params: { id: string } }>('/operations/:id/replay', async (request, reply) => {
    const id = z.string().uuid().parse(request.params.id);
    const status = await transaction(pool, async (client) => {
      const row = (
        await client.query('SELECT * FROM operations WHERE operation_id=$1 FOR UPDATE', [id])
      ).rows[0];
      if (!row) return 404;
      if (row.status !== 'failed') return 409;
      await client.query(
        "UPDATE operations SET status='pending',error=NULL WHERE operation_id=$1",
        [id],
      );
      await client.query('INSERT INTO jobs(operation_id) VALUES ($1)', [id]);
      await audit(client, 'job_replayed', id);
      return 202;
    });
    if (status === 202) await redis.notify();
    return reply.code(status).send(
      status === 202
        ? { operation_id: id, status: 'pending' }
        : {
            detail:
              status === 404 ? 'Operation not found' : 'Only failed operations can be replayed',
          },
    );
  });
  app.post('/snapshots', async (_request, reply) =>
    reply.code(201).send(await new SnapshotDetector(pool, erp, redis).run()),
  );
  app.post('/reconciliation', async () => new Reconciler(pool, erp, pm).run());
  app.post('/chaos/plans', async (request, reply) => {
    const body = z
      .object({
        seed: z.number().int().min(0).max(0xffffffff),
        steps: z.number().int().min(1).max(1000).default(20),
      })
      .parse(request.body);
    const id = randomUUID();
    const sequence = plan(body.seed, body.steps);
    const invariants = pendingResults();
    await pool.query(
      'INSERT INTO chaos_runs(id,seed,configuration,failure_sequence,invariant_results) VALUES ($1,$2,$3,$4,$5)',
      [id, body.seed, JSON.stringify(body), JSON.stringify(sequence), JSON.stringify(invariants)],
    );
    return reply.code(201).send({ id, status: 'planned', seed: body.seed, sequence, invariants });
  });
  app.post('/ingress/invoices', async (_request, reply) =>
    reply.code(501).send({
      detail: 'AI invoice ingress is disabled until its safe ERP write path is implemented',
    }),
  );
  return app;
}
