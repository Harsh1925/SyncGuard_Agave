import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chaosRequestSchema, createChaos } from '../chaos/runner.js';
import { demoEnabled, setFault } from '../chaos/simulator.js';
import { ingressSchema, acceptInvoice } from '../ingress/service.js';
import { SyntheticExtractor, OpenAIExtractor } from '../ingress/extractor.js';
import type pg from 'pg';
import { z } from 'zod';
import type { Metrics } from '@syncguard/contracts';
import type { Settings } from '../config.js';
import { server } from './server.js';
import { ERPAdapter } from '../adapters/erp.js';
import { PMAdapter } from '../adapters/pm.js';
import { SnapshotDetector } from '../engine/detector.js';
import { SyncWorker } from '../engine/worker.js';
import { Reconciler } from '../engine/reconciler.js';
import { RedisSupport } from '../state/redis.js';
import { transaction } from '../state/database.js';
import { audit } from '../state/repository.js';
import { plan, pendingResults } from '../chaos/planner.js';

export async function buildApi(pool: pg.Pool, settings: Settings, redis: RedisSupport) {
  if (settings.ENABLE_FAULTS === 'true')
    throw new Error('Fault hooks must run in disposable CLI processes, not the API');
  const app = await server('SyncGuard');
  const controls = demoEnabled(settings.DATABASE_URL);
  const erp = new ERPAdapter(pool, controls);
  const children = new Set<ReturnType<typeof spawn>>();
  app.addHook('onClose', async () => {
    for (const child of children) child.kill('SIGTERM');
  });
  app.get('/capabilities', async () => ({
    demo_controls: controls,
    llm_configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
  }));
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
  app.get(
    '/demo/runs',
    async () =>
      (
        await pool.query(
          "SELECT * FROM chaos_runs WHERE configuration->>'kind'='scripted-demo' ORDER BY created_at DESC LIMIT 20",
        )
      ).rows,
  );
  app.get(
    '/drift',
    async () =>
      (await pool.query('SELECT * FROM drift_reports ORDER BY detected_at DESC LIMIT 100')).rows,
  );
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
  app.post('/ingress/invoices', async (request, reply) => {
    const body = ingressSchema.parse(request.body);
    if (body.mode === 'llm' && (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL))
      return reply
        .code(503)
        .send({ detail: 'Configure OPENAI_API_KEY and OPENAI_MODEL for LLM extraction' });
    const extractor =
      body.mode === 'llm'
        ? new OpenAIExtractor(process.env.OPENAI_API_KEY!, process.env.OPENAI_MODEL!)
        : new SyntheticExtractor();
    const result = await acceptInvoice(pool, pm, body, extractor);
    return reply.code(result.status === 'accepted' ? 201 : 422).send(result);
  });
  app.post('/work/step', async (_request, reply) => {
    if (!controls)
      return reply
        .code(403)
        .send({ detail: 'Manual worker execution requires the isolated demo environment' });
    if ((await pool.query("SELECT 1 FROM chaos_runs WHERE status='running' LIMIT 1")).rowCount)
      return reply.code(409).send({ detail: 'Wait for the active run to finish' });
    return { processed: await new SyncWorker(pool, settings, pm, redis).runOnce() };
  });
  app.get(
    '/ingress/operations',
    async () =>
      (await pool.query('SELECT * FROM ingress_operations ORDER BY created_at DESC LIMIT 50')).rows,
  );
  app.get(
    '/chaos/runs',
    async () =>
      (await pool.query('SELECT * FROM chaos_runs ORDER BY created_at DESC LIMIT 20')).rows,
  );
  app.get<{ Params: { id: string } }>('/chaos/runs/:id', async (request, reply) => {
    const id = z.string().uuid().parse(request.params.id);
    return (
      (await pool.query('SELECT * FROM chaos_runs WHERE id=$1', [id])).rows[0] ??
      reply.code(404).send({ detail: 'Run not found' })
    );
  });
  app.post('/chaos/runs', async (request, reply) => {
    if (!controls)
      return reply
        .code(403)
        .send({ detail: 'Failure execution is available only in the isolated demo environment' });
    const input = chaosRequestSchema.parse(request.body);
    if ((await pool.query("SELECT 1 FROM chaos_runs WHERE status='running' LIMIT 1")).rowCount)
      return reply
        .code(409)
        .send({ detail: 'A run is already active. Refresh its results before starting another.' });
    const id = await createChaos(pool, input);
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../cli.ts', import.meta.url)), 'chaos-run', id],
      {
        env: { ...process.env, DATABASE_URL: settings.DATABASE_URL, PM_URL: settings.PM_URL },
        stdio: 'inherit',
      },
    );
    children.add(child);
    const fail = async (message: string) => {
      await pool.query(
        "UPDATE chaos_runs SET status='failed',completed_at=now(),operation_counts=operation_counts||$2::jsonb WHERE id=$1 AND status IN ('planned','running')",
        [id, JSON.stringify({ error: message })],
      );
    };
    child.once('error', (error) => {
      children.delete(child);
      void fail(error.message).catch((error) => app.log.error(error));
    });
    child.once('exit', (code) => {
      children.delete(child);
      if (code !== 0) void fail(`Runner exited ${code}`).catch((error) => app.log.error(error));
    });
    return reply.code(202).send({ id, status: 'planned' });
  });
  app.post('/simulator/faults', async (request, reply) => {
    if (!controls)
      return reply
        .code(403)
        .send({ detail: 'Fault injection requires the isolated demo environment' });
    return setFault(pool, request.body);
  });
  app.post<{ Params: { id: string } }>('/drift/:id/inject', async (request, reply) => {
    if (!controls)
      return reply
        .code(403)
        .send({ detail: 'Drift injection requires the isolated demo environment' });
    const id = z.string().uuid().parse(request.params.id);
    const body = z
      .object({ amount: z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/) })
      .strict()
      .parse(request.body);
    const record = await pm.get(id);
    if (!record) return reply.code(404).send({ detail: 'Replica invoice not found' });
    const response = await fetch(`${settings.PM_URL}/invoices/${id}/direct-edit`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...record.invoice, amount: body.amount }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Drift injection failed');
    return new Reconciler(pool, erp, pm).run();
  });

  return app;
}
