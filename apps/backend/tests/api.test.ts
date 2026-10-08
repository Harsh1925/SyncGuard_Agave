import { afterEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildApi } from '../src/api/app.js';
import { buildERP } from '../src/simulators/erp.js';
import { buildPM } from '../src/simulators/pm.js';
import { loadSettings } from '../src/config.js';
import { RedisSupport } from '../src/state/redis.js';
import type { FastifyInstance } from 'fastify';
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
});
const unusablePool = {
  query: () => {
    throw new Error('Database access must not occur');
  },
} as unknown as pg.Pool;
describe('HTTP trust boundaries', () => {
  it('refuses numeric money before an ERP financial write', async () => {
    app = await buildERP(unusablePool);
    const response = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        company_id: 'ACME',
        vendor_id: 'V001',
        invoice_number: 'INV-1001',
        job_id: 'J001',
        amount: 1250,
        currency: 'USD',
        issued_on: '2026-01-15',
      },
    });
    expect(response.statusCode).toBe(400);
  });
  it('refuses malformed PM versions before a destination write', async () => {
    app = await buildPM(unusablePool, new RedisSupport());
    const response = await app.inject({
      method: 'PUT',
      url: '/invoices/00000000-0000-4000-8000-000000000001',
      payload: {
        operation_id: '00000000-0000-4000-8000-000000000001',
        version: 'bad',
        action: 'delete',
        invoice: null,
      },
    });
    expect(response.statusCode).toBe(400);
  });
  it('validates UUID before touching the database', async () => {
    app = await buildApi(unusablePool, loadSettings({}), new RedisSupport());
    expect((await app.inject('/operations/not-a-uuid')).statusCode).toBe(400);
  });
  it('fails closed on unfinished AI financial ingress', async () => {
    app = await buildApi(unusablePool, loadSettings({}), new RedisSupport());
    expect((await app.inject({ method: 'POST', url: '/ingress/invoices' })).statusCode).toBe(501);
  });
  it('refuses chaos seeds outside the declared range', async () => {
    app = await buildApi(unusablePool, loadSettings({}), new RedisSupport());
    expect(
      (await app.inject({ method: 'POST', url: '/chaos/plans', payload: { seed: -1 } })).statusCode,
    ).toBe(400);
  });
  it('prevents hard-exit hook activation on API servers', async () =>
    expect(
      buildApi(unusablePool, loadSettings({ ENABLE_FAULTS: 'true' }), new RedisSupport()),
    ).rejects.toThrow('disposable CLI'));
});
