import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { v5 as uuidv5 } from 'uuid';
import { invoiceSchema, type Invoice, type Action } from '@syncguard/contracts';

export function normalizeInvoice(input: unknown): Invoice {
  const invoice = invoiceSchema.parse(input);
  return { ...invoice, amount: new Decimal(invoice.amount).toFixed(2) };
}
export function logicalId(invoice: Invoice): string {
  // Match the earlier Python scaffold's JSON array encoding to preserve business UUIDs.
  const encode = (value: string) =>
    JSON.stringify(value).replace(
      /[\u0080-\uffff]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
  const key = `[${[invoice.company_id, invoice.vendor_id, invoice.invoice_number].map(encode).join(', ')}]`;
  return uuidv5(key, uuidv5.URL);
}
export function fingerprint(invoice: Invoice): string {
  const canonical = normalizeInvoice(invoice);
  const sorted = Object.fromEntries(
    Object.entries(canonical).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
export const operationId = (id: string, version: string, action: Action): string =>
  uuidv5(`syncguard:pm:${id}:${version}:${action}`, uuidv5.URL);
export const isStale = (version: string, applied: string, tombstone: string | null): boolean =>
  BigInt(version) <= BigInt(applied) || BigInt(version) <= BigInt(tombstone ?? '0');
export interface Change {
  logicalId: string;
  action: Action;
  desired: Invoice | null;
  fingerprint: string | null;
}
export function deriveChanges(previous: Map<string, string>, current: Invoice[]): Change[] {
  const next = new Map(current.map((invoice) => [logicalId(invoice), invoice]));
  const result: Change[] = [];
  for (const [id, invoice] of next)
    if (previous.get(id) !== fingerprint(invoice)) {
      result.push({
        logicalId: id,
        action: 'upsert',
        desired: normalizeInvoice(invoice),
        fingerprint: fingerprint(invoice),
      });
    }
  for (const id of previous.keys())
    if (!next.has(id))
      result.push({ logicalId: id, action: 'delete', desired: null, fingerprint: null });
  return result.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
}
