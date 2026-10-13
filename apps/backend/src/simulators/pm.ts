import type pg from 'pg';
import { setTimeout as sleep } from 'node:timers/promises';
import { consumeFault } from '../chaos/simulator.js';
import { z } from 'zod';
import { invoiceSchema, invoiceBodySchema } from '@syncguard/contracts';
import { normalizeInvoice, logicalId } from '../domain/invoice.js';
import { server } from '../api/server.js';
import { transaction } from '../state/database.js';
import { RedisSupport } from '../state/redis.js';

const writeSchema = z
  .object({
    operation_id: z.string().uuid(),
    version: z
      .string()
      .regex(/^[1-9]\d*$/)
      .refine((value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= 9223372036854775807n),
    action: z.enum(['upsert', 'delete']),
    invoice: invoiceSchema.nullable(),
  })
  .strict()
  .refine(
    (body) => (body.action === 'upsert') === (body.invoice !== null),
    'Upsert requires an invoice; delete requires null',
  );
export async function buildPM(pool: pg.Pool, redis: RedisSupport, controls = false) {
  const app = await server('Modern PM simulator');
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    if (!(await redis.allow(`syncguard:pm-rate:${request.ip}`, controls ? 100000 : 100, 60)))
      return reply
        .header('Retry-After', '60')
        .code(429)
        .send({ detail: 'Simulator rate limit reached' });
  });
  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });
  app.get('/jobs', async () => (await pool.query('SELECT * FROM pm_sim.jobs ORDER BY id')).rows);
  app.get<{ Params: { id: string } }>('/operations/:id', async (request, reply) => {
    const id = z.string().uuid().parse(request.params.id);
    const row = (await pool.query('SELECT * FROM pm_sim.receipts WHERE operation_id=$1', [id]))
      .rows[0];
    return row ?? reply.code(404).send({ detail: 'Operation not found' });
  });
  app.get<{ Querystring: { cursor?: string; limit?: string } }>('/invoices', async (request) => {
    const query = z
      .object({
        cursor: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    const rows = (
      await pool.query(
        'SELECT * FROM pm_sim.invoices WHERE NOT deleted AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
        [query.cursor ?? null, query.limit + 1],
      )
    ).rows;
    const items = rows.slice(0, query.limit);
    return { items, next_cursor: rows.length > query.limit ? items.at(-1).id : null };
  });
  app.get<{ Params: { id: string } }>('/invoices/:id', async (request, reply) => {
    const id = z.string().uuid().parse(request.params.id);
    const row = (
      await pool.query('SELECT * FROM pm_sim.invoices WHERE id=$1 AND NOT deleted', [id])
    ).rows[0];
    return row ?? reply.code(404).send({ detail: 'Invoice not found' });
  });
  app.put<{ Params: { id: string } }>(
    '/invoices/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['operation_id', 'version', 'action', 'invoice'],
          additionalProperties: false,
          properties: {
            operation_id: { type: 'string', format: 'uuid' },
            version: { type: 'string', pattern: '^[1-9][0-9]*$' },
            action: { type: 'string', enum: ['upsert', 'delete'] },
            invoice: { anyOf: [invoiceBodySchema, { type: 'null' }] },
          },
        },
      },
    },
    async (request, reply) => {
      const id = z.string().uuid().parse(request.params.id);
      const body = writeSchema.parse(request.body);
      const fault = controls ? await consumeFault(pool, 'pm') : undefined;
      if (fault?.delay_ms && fault.kind !== 'lost_response') await sleep(fault.delay_ms);
      if (fault?.kind === 'transient_failure')
        return reply.code(503).send({ detail: 'Injected upstream failure' });
      if (fault?.kind === 'rate_limit')
        return reply.header('Retry-After', '1').code(429).send({ detail: 'Injected rate limit' });
      if (body.invoice) body.invoice = normalizeInvoice(body.invoice);
      if (body.invoice && logicalId(body.invoice) !== id)
        return reply.code(400).send({ detail: 'Business identity does not match logical ID' });
      const result = await transaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [id]);
        const prior = (
          await client.query('SELECT * FROM pm_sim.receipts WHERE operation_id=$1', [
            body.operation_id,
          ])
        ).rows[0];
        if (prior) {
          // Compare supported fields; JSONB and JS objects have different key ordering.
          if (
            prior.logical_id !== id ||
            String(prior.request.version) !== body.version ||
            prior.request.action !== body.action ||
            JSON.stringify(normalizedReceipt(prior.request.invoice)) !==
              JSON.stringify(normalizedReceipt(body.invoice))
          ) {
            return { status: 409, detail: 'Operation ID reused with different state' };
          }
          return { status: 200, duplicate: true };
        }
        const row = (await client.query('SELECT version FROM pm_sim.invoices WHERE id=$1', [id]))
          .rows[0];
        if (row && BigInt(body.version) <= BigInt(row.version))
          return { status: 409, detail: 'Stale replica version' };
        await client.query(
          `INSERT INTO pm_sim.invoices(id,version,invoice,deleted,operation_id) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,invoice=EXCLUDED.invoice,deleted=EXCLUDED.deleted,operation_id=EXCLUDED.operation_id,updated_at=now()`,
          [
            id,
            body.version,
            body.invoice ? JSON.stringify(body.invoice) : null,
            body.action === 'delete',
            body.operation_id,
          ],
        );
        await client.query(
          'INSERT INTO pm_sim.receipts(operation_id,logical_id,version,request) VALUES ($1,$2,$3,$4)',
          [body.operation_id, id, body.version, JSON.stringify(body)],
        );
        return { status: 200, duplicate: false };
      });
      if (fault?.kind === 'lost_response' && result.status === 200) {
        // Commit has completed. Destroy the response transport to make the outcome uncertain.
        reply.hijack();
        request.raw.socket.destroy();
        return reply;
      }
      return reply.code(result.status).send({ id, ...result });
    },
  );
  app.patch<{ Params: { id: string } }>(
    '/invoices/:id/direct-edit',
    { schema: { body: invoiceBodySchema } },
    async (request, reply) => {
      const id = z.string().uuid().parse(request.params.id);
      const invoice = normalizeInvoice(request.body);
      if (logicalId(invoice) !== id)
        return reply.code(400).send({ detail: 'Business identity cannot be edited' });
      const row = await pool.query(
        'UPDATE pm_sim.invoices SET invoice=$1,updated_at=now() WHERE id=$2 AND NOT deleted RETURNING id',
        [JSON.stringify(invoice), id],
      );
      return row.rowCount
        ? { id, drift_injected: true }
        : reply.code(404).send({ detail: 'Invoice not found' });
    },
  );
  return app;
}
function normalizedReceipt(invoice: unknown) {
  return invoice ? normalizeInvoice(invoice) : null;
}
