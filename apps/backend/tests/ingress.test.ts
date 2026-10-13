import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPool, migrate } from '../src/state/database.js';
import { seed } from '../src/simulators/erp.js';
import { acceptInvoice } from '../src/ingress/service.js';
import { SyntheticExtractor, OpenAIExtractor } from '../src/ingress/extractor.js';
import { ERPAdapter } from '../src/adapters/erp.js';
import { SnapshotDetector } from '../src/engine/detector.js';
import { RedisSupport } from '../src/state/redis.js';
import { normalizeInvoice } from '../src/domain/invoice.js';
const invoice = normalizeInvoice({
  company_id: 'ACME',
  vendor_id: 'V001',
  invoice_number: 'INGRESS-001',
  job_id: 'J001',
  amount: '15.00',
  currency: 'USD',
  issued_on: '2026-01-15',
});
it('synthetic extractor never trusts invalid monetary types', async () => {
  expect(() => normalizeInvoice(JSON.parse('{"amount":12}'))).toThrow();
  expect(await new SyntheticExtractor().extract('{"amount":"12.00"}')).toEqual({ amount: '12.00' });
});
it('LLM extractor fails closed without provider configuration', async () => {
  await expect(new OpenAIExtractor('', '').extract('invoice')).rejects.toThrow('not configured');
});
it('LLM output is parsed through the structured Responses transport', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(invoice) }] },
        ],
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  try {
    expect(
      await new OpenAIExtractor('synthetic-test-key', 'configured-model').extract(
        'Synthetic invoice',
      ),
    ).toEqual(invoice);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.text.format.type).toBe('json_schema');
  } finally {
    vi.unstubAllGlobals();
  }
});
describe.skipIf(!process.env.TEST_DATABASE_URL)('Safe ERP ingress integration', () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!);
  const pm = { jobs: async () => [{ id: 'J001', name: 'Demo job', active: true }] };
  beforeEach(async () => {
    await migrate(pool);
    await pool.query(
      'TRUNCATE ingress_operations,audit_events,jobs,operations,snapshot_members,snapshots,records,drift_reports,chaos_runs,pm_sim.receipts,pm_sim.invoices,erp_sim."AP_INV",erp_sim."AP_VND",erp_sim.initialization CASCADE',
    );
    await seed(pool);
  });
  afterAll(async () => pool.end());
  const proposal = (data: unknown = invoice) => ({
    operation_id: randomUUID(),
    document: JSON.stringify(data),
    mode: 'synthetic',
  });
  it('validates and accepts once, and safely replays an accepted operation', async () => {
    const input = proposal();
    expect((await acceptInvoice(pool, pm, input, new SyntheticExtractor())).status).toBe(
      'accepted',
    );
    expect((await acceptInvoice(pool, pm, input, new SyntheticExtractor())).status).toBe(
      'accepted',
    );
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM erp_sim."AP_INV" WHERE "INV_NO"=$1', [
          invoice.invoice_number,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect((await acceptInvoice(pool, pm, proposal(), new SyntheticExtractor())).status).toBe(
      'refused',
    );
  });
  it('rejects unknown vendor, inactive job and invalid extracted fields with an audit', async () => {
    expect(
      (
        await acceptInvoice(
          pool,
          pm,
          proposal({ ...invoice, vendor_id: 'UNKNOWN' }),
          new SyntheticExtractor(),
        )
      ).status,
    ).toBe('refused');
    expect(
      (
        await acceptInvoice(
          pool,
          { jobs: async () => [{ id: 'J001', name: 'closed', active: false }] },
          proposal(),
          new SyntheticExtractor(),
        )
      ).status,
    ).toBe('refused');
    expect(
      (
        await acceptInvoice(
          pool,
          pm,
          proposal({ ...invoice, amount: 15 }),
          new SyntheticExtractor(),
        )
      ).status,
    ).toBe('refused');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE event='ai_invoice_refused'",
        )
      ).rows[0].n,
    ).toBe(3);
  });
  it('serializes two concurrent proposals for the same business identity', async () => {
    const results = await Promise.all([
      acceptInvoice(pool, pm, proposal(), new SyntheticExtractor()),
      acceptInvoice(pool, pm, proposal(), new SyntheticExtractor()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['accepted', 'refused']);
  });
  it('correlates accepted own writes while allowing exactly one normal observation', async () => {
    const detector = new SnapshotDetector(pool, new ERPAdapter(pool), new RedisSupport());
    await detector.run();
    await acceptInvoice(pool, pm, proposal(), new SyntheticExtractor());
    expect((await detector.run()).changes).toBe(1);
    expect((await detector.run()).changes).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_events WHERE event='own_write_correlated'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('rejects operation ID reuse with a changed document', async () => {
    const input = proposal();
    await acceptInvoice(pool, pm, input, new SyntheticExtractor());
    const result = await acceptInvoice(
      pool,
      pm,
      { ...input, document: JSON.stringify({ ...invoice, amount: '99.00' }) },
      new SyntheticExtractor(),
    );
    expect(result.reasons).toEqual(['operation_id_reused']);
  });
});
