import type { Invoice, Job, Vendor } from '@syncguard/contracts';
import { logicalId } from '../domain/invoice.js';
export interface InvoiceExtractor {
  extract(document: string): Promise<unknown>;
}
export function validateInvoice(
  invoice: Invoice,
  vendors: Vendor[],
  jobs: Job[],
  existing: Set<string>,
): string[] {
  const reasons = [];
  if (!vendors.some((v) => v.id === invoice.vendor_id && v.company_id === invoice.company_id))
    reasons.push('unknown_vendor');
  if (!jobs.some((j) => j.id === invoice.job_id && j.active))
    reasons.push('unknown_or_inactive_job');
  if (existing.has(logicalId(invoice))) reasons.push('duplicate_invoice_business_key');
  return reasons;
}
export const isKnownWrite = (observed: string, expected: string | null): boolean =>
  expected !== null && observed === expected;
