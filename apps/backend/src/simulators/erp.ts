import type pg from 'pg';
import { invoiceBodySchema } from '@syncguard/contracts';
import { normalizeInvoice, logicalId } from '../domain/invoice.js';
import { ERPAdapter } from '../adapters/erp.js';
import { server } from '../api/server.js';
import { transaction } from '../state/database.js';

export async function seed(pool: pg.Pool): Promise<void> {
  await transaction(pool, async (client) => {
    const prior = (
      await client.query(`SELECT EXISTS(SELECT 1 FROM snapshots WHERE status='COMPLETE') AS baseline,
      EXISTS(SELECT 1 FROM erp_sim."AP_INV") AS populated,
      EXISTS(SELECT 1 FROM erp_sim.initialization) AS initialized`)
    ).rows[0];
    if (prior.initialized) return; // A deliberate delete must survive repeated bootstraps.
    if (prior.baseline && !prior.populated)
      throw new Error(
        'Existing snapshots found but new ERP schema is empty. Import legacy ERP data before seeding or polling.',
      );
    if (prior.populated) {
      await client.query('INSERT INTO erp_sim.initialization DEFAULT VALUES');
      return;
    }
    await client.query(
      `INSERT INTO erp_sim."AP_VND" VALUES ('ACME','V001','Harbor Concrete') ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `INSERT INTO erp_sim."AP_INV" VALUES ('ACME','V001','INV-1001','J001',1250.00,'USD','2026-01-15','O') ON CONFLICT DO NOTHING`,
    );
    await client.query('INSERT INTO erp_sim.initialization DEFAULT VALUES');
  });
}
export async function buildERP(pool: pg.Pool) {
  const app = await server('Legacy ERP simulator');
  const adapter = new ERPAdapter(pool);
  app.get('/health', async () => {
    await pool.query('SELECT 1 FROM erp_sim."AP_INV" LIMIT 1');
    return { status: 'ok' };
  });
  app.get('/invoices', async () => adapter.snapshot());
  app.get('/vendors', async () => adapter.vendors());
  app.post('/invoices', { schema: { body: invoiceBodySchema } }, async (request, reply) => {
    const invoice = normalizeInvoice(request.body);
    await pool.query('INSERT INTO erp_sim."AP_INV" VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      invoice.company_id,
      invoice.vendor_id,
      invoice.invoice_number,
      invoice.job_id,
      invoice.amount,
      invoice.currency,
      invoice.issued_on,
      { open: 'O', paid: 'P', void: 'V' }[invoice.status],
    ]);
    return reply.code(201).send({ logical_id: logicalId(invoice) });
  });
  app.put('/invoices', { schema: { body: invoiceBodySchema } }, async (request, reply) => {
    const invoice = normalizeInvoice(request.body);
    const result = await pool.query(
      `UPDATE erp_sim."AP_INV" SET "JB_NO"=$1,"GROSS_AMT"=$2,"CCY"=$3,"INV_DT"=$4,"ST_CD"=$5 WHERE "CO_CD"=$6 AND "VND_NO"=$7 AND "INV_NO"=$8`,
      [
        invoice.job_id,
        invoice.amount,
        invoice.currency,
        invoice.issued_on,
        { open: 'O', paid: 'P', void: 'V' }[invoice.status],
        invoice.company_id,
        invoice.vendor_id,
        invoice.invoice_number,
      ],
    );
    if (!result.rowCount) return reply.code(404).send({ detail: 'Invoice not found' });
    return { logical_id: logicalId(invoice) };
  });
  app.delete<{ Params: { company: string; vendor: string; number: string } }>(
    '/invoices/:company/:vendor/:number',
    async (request) => {
      const { company, vendor, number } = request.params;
      await pool.query(
        'DELETE FROM erp_sim."AP_INV" WHERE "CO_CD"=$1 AND "VND_NO"=$2 AND "INV_NO"=$3',
        [company, vendor, number],
      );
      return { deleted: true };
    },
  );
  return app;
}
