import { createHash } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { normalizeInvoice, fingerprint, logicalId } from '../domain/invoice.js';
import { fromERP, type LegacyInvoice } from '../adapters/erp.js';
import { PMAdapter } from '../adapters/pm.js';
import { transaction } from '../state/database.js';
import { audit } from '../state/repository.js';
import { validateInvoice, type InvoiceExtractor } from './validation.js';
export const ingressSchema = z
  .object({
    operation_id: z.string().uuid(),
    document: z.string().min(1).max(20000),
    mode: z.enum(['synthetic', 'llm']).default('synthetic'),
  })
  .strict();
export async function acceptInvoice(
  pool: pg.Pool,
  pm: Pick<PMAdapter, 'jobs'>,
  raw: unknown,
  extractor: InvoiceExtractor,
) {
  const input = ingressSchema.parse(raw);
  const hash = createHash('sha256')
    .update(JSON.stringify([input.mode, input.document]))
    .digest('hex');
  await pool.query(
    `INSERT INTO ingress_operations(operation_id,request_hash,status) VALUES ($1,$2,'pending') ON CONFLICT DO NOTHING`,
    [input.operation_id, hash],
  );
  const prior = (
    await pool.query('SELECT * FROM ingress_operations WHERE operation_id=$1', [input.operation_id])
  ).rows[0];
  if (prior.request_hash !== hash) {
    await pool.query('INSERT INTO audit_events(event,detail) VALUES ($1,$2)', [
      'ai_invoice_refused',
      JSON.stringify({
        ingress_operation_id: input.operation_id,
        reasons: ['operation_id_reused'],
      }),
    ]);
    return {
      status: 'refused',
      reasons: ['operation_id_reused'],
      operation_id: input.operation_id,
    };
  }
  if (prior.status !== 'pending') return prior;
  let invoice;
  try {
    invoice = normalizeInvoice(prior.desired ?? (await extractor.extract(input.document)));
  } catch {
    return transaction(pool, async (client) => {
      const row = (
        await client.query('SELECT * FROM ingress_operations WHERE operation_id=$1 FOR UPDATE', [
          input.operation_id,
        ])
      ).rows[0];
      if (row.status !== 'pending') return row;
      await client.query(
        "UPDATE ingress_operations SET status='refused',reasons='[\"invalid_or_unavailable_extraction\"]',completed_at=now() WHERE operation_id=$1",
        [input.operation_id],
      );
      await audit(client, 'ai_invoice_refused', null, {
        ingress_operation_id: input.operation_id,
        reasons: ['invalid_or_unavailable_extraction'],
      });
      return {
        status: 'refused',
        reasons: ['invalid_or_unavailable_extraction'],
        operation_id: input.operation_id,
      };
    });
  }
  // First normalized proposal wins even when two extractions race on one operation ID.
  const frozen =
    (
      await pool.query(
        `UPDATE ingress_operations SET desired=$2,logical_id=$3,expected_fingerprint=$4
    WHERE operation_id=$1 AND desired IS NULL RETURNING *`,
        [input.operation_id, JSON.stringify(invoice), logicalId(invoice), fingerprint(invoice)],
      )
    ).rows[0] ??
    (
      await pool.query('SELECT * FROM ingress_operations WHERE operation_id=$1', [
        input.operation_id,
      ])
    ).rows[0];
  invoice = normalizeInvoice(frozen.desired);
  const id = logicalId(invoice);
  const jobs = await pm.jobs();
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,2))', [id]);
    const row = (
      await client.query('SELECT * FROM ingress_operations WHERE operation_id=$1 FOR UPDATE', [
        input.operation_id,
      ])
    ).rows[0];
    if (row.status !== 'pending') return row;
    const desired = normalizeInvoice(row.desired);
    const vendors = (
      await client.query(
        'SELECT "CO_CD" AS company_id,"VND_NO" AS id,"NM" AS name FROM erp_sim."AP_VND"',
      )
    ).rows;
    const existing = (
      await client.query<LegacyInvoice>(
        'SELECT *,"INV_DT"::text AS "INV_DT" FROM erp_sim."AP_INV" WHERE "CO_CD"=$1 AND "VND_NO"=$2 AND "INV_NO"=$3',
        [desired.company_id, desired.vendor_id, desired.invoice_number],
      )
    ).rows[0];
    const reasons = validateInvoice(desired, vendors, jobs, new Set(existing ? [id] : []));
    if (reasons.length) {
      await client.query(
        "UPDATE ingress_operations SET status='refused',reasons=$2,completed_at=now() WHERE operation_id=$1",
        [input.operation_id, JSON.stringify(reasons)],
      );
      await audit(client, 'ai_invoice_refused', null, {
        ingress_operation_id: input.operation_id,
        reasons,
      });
      return { status: 'refused', operation_id: input.operation_id, reasons };
    }
    await client.query('INSERT INTO erp_sim."AP_INV" VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      desired.company_id,
      desired.vendor_id,
      desired.invoice_number,
      desired.job_id,
      desired.amount,
      desired.currency,
      desired.issued_on,
      { open: 'O', paid: 'P', void: 'V' }[desired.status],
    ]);
    const actual = (
      await client.query<LegacyInvoice>(
        'SELECT *,"INV_DT"::text AS "INV_DT" FROM erp_sim."AP_INV" WHERE "CO_CD"=$1 AND "VND_NO"=$2 AND "INV_NO"=$3',
        [desired.company_id, desired.vendor_id, desired.invoice_number],
      )
    ).rows[0];
    if (fingerprint(fromERP(actual)) !== row.expected_fingerprint)
      throw new Error('ERP write did not verify');
    await client.query(
      "UPDATE ingress_operations SET status='accepted',completed_at=now() WHERE operation_id=$1",
      [input.operation_id],
    );
    await audit(client, 'ai_invoice_accepted', null, {
      ingress_operation_id: input.operation_id,
      logical_id: id,
      verification: 'business_key_and_fingerprint',
    });
    return { status: 'accepted', operation_id: input.operation_id, logical_id: id, reasons: [] };
  });
}
