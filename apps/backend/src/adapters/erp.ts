import type pg from 'pg';
import type { Invoice, Vendor } from '@syncguard/contracts';
import { normalizeInvoice } from '../domain/invoice.js';

export interface LegacyInvoice {
  CO_CD: string;
  VND_NO: string;
  INV_NO: string;
  JB_NO: string;
  GROSS_AMT: string;
  CCY: string;
  INV_DT: string;
  ST_CD: string;
}
export function fromERP(row: LegacyInvoice): Invoice {
  return normalizeInvoice({
    company_id: row.CO_CD,
    vendor_id: row.VND_NO,
    invoice_number: row.INV_NO,
    job_id: row.JB_NO,
    amount: row.GROSS_AMT,
    currency: row.CCY,
    issued_on: row.INV_DT,
    status: ({ O: 'open', P: 'paid', V: 'void' } as Record<string, string>)[row.ST_CD],
  });
}
export class ERPAdapter {
  constructor(private pool: pg.Pool) {}
  async snapshot(): Promise<Invoice[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const rows = await client.query<LegacyInvoice>(
        `SELECT *,"INV_DT"::text AS "INV_DT" FROM erp_sim."AP_INV" ORDER BY "CO_CD","VND_NO","INV_NO"`,
      );
      const invoices = rows.rows.map(fromERP);
      await client.query('COMMIT');
      return invoices;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async vendors(): Promise<Vendor[]> {
    const { rows } = await this.pool.query(
      'SELECT "CO_CD" AS company_id,"VND_NO" AS id,"NM" AS name FROM erp_sim."AP_VND"',
    );
    return rows;
  }
}
