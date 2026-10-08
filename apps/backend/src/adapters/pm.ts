import type { Invoice, Job, Operation } from '@syncguard/contracts';
import { fingerprint, logicalId, normalizeInvoice } from '../domain/invoice.js';
export interface PMRecord {
  id: string;
  invoice: Invoice;
  version: string;
}
export class UpstreamError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class PMAdapter {
  constructor(private baseUrl: string) {}
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok && response.status !== 404)
      throw new UpstreamError(response.status, `PM returned HTTP ${response.status}`);
    return response;
  }
  async get(id: string): Promise<PMRecord | null> {
    const response = await this.request(`/invoices/${id}`);
    return response.status === 404 ? null : (response.json() as Promise<PMRecord>);
  }
  async verify(operation: Operation): Promise<boolean> {
    const response = await this.request(`/operations/${operation.operation_id}`);
    if (response.status === 404) return false;
    const receipt = (await response.json()) as { version: string; logical_id: string };
    if (
      String(receipt.version) !== operation.version ||
      receipt.logical_id !== operation.logical_id
    )
      return false;
    const actual = await this.get(operation.logical_id);
    return operation.action === 'delete'
      ? actual === null
      : actual !== null && fingerprint(actual.invoice) === operation.fingerprint;
  }
  async write(operation: Operation): Promise<void> {
    const response = await this.request(`/invoices/${operation.logical_id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: operation.operation_id,
        version: operation.version,
        action: operation.action,
        invoice: operation.desired,
      }),
    });
    if (!response.ok) throw new UpstreamError(response.status, 'PM write failed');
  }
  async jobs(): Promise<Job[]> {
    const response = await this.request('/jobs');
    if (!response.ok) throw new UpstreamError(response.status, 'Job lookup failed');
    return response.json() as Promise<Job[]>;
  }
  async invoices(): Promise<Map<string, Invoice>> {
    const result = new Map<string, Invoice>();
    let cursor: string | null = null;
    do {
      const response = await this.request(`/invoices${cursor ? `?cursor=${cursor}` : ''}`);
      if (!response.ok) throw new UpstreamError(response.status, 'PM listing failed');
      const page = (await response.json()) as { items: PMRecord[]; next_cursor: string | null };
      for (const record of page.items) {
        const invoice = normalizeInvoice(record.invoice);
        result.set(logicalId(invoice), invoice);
      }
      cursor = page.next_cursor;
    } while (cursor);
    return result;
  }
}
