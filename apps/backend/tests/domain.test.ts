import { describe, expect, it } from 'vitest';
import {
  deriveChanges,
  fingerprint,
  logicalId,
  isStale,
  normalizeInvoice,
  operationId,
} from '../src/domain/invoice.js';
import { fromERP } from '../src/adapters/erp.js';
import { plan, pendingResults } from '../src/chaos/planner.js';
import { validateInvoice, isKnownWrite } from '../src/ingress/validation.js';
import { RedisSupport } from '../src/state/redis.js';
export const invoice = normalizeInvoice({
  company_id: 'ACME',
  vendor_id: 'V001',
  invoice_number: 'INV-1001',
  job_id: 'J001',
  amount: '1250.00',
  currency: 'USD',
  issued_on: '2026-01-15',
});

describe('canonical financial state', () => {
  it('preserves UUIDs from the Python scaffold for ASCII and Unicode keys', () => {
    expect(logicalId(invoice)).toBe('6e47c778-c36a-56a6-bc11-d641d004bdb5');
    expect(logicalId({ ...invoice, company_id: 'ÅCME' })).toBe(
      '4d295d3c-9754-5d0e-b846-6136c14b8cbd',
    );
  });
  it('normalizes equivalent decimal strings to one fingerprint', () =>
    expect(fingerprint({ ...invoice, amount: '1250.0' })).toBe(fingerprint(invoice)));
  it.each(['-1', '0.001', 'NaN', 'Infinity', '1e3', '99999999999999999'])(
    'rejects invalid money %s',
    (amount) => expect(() => normalizeInvoice({ ...invoice, amount })).toThrow(),
  );
  it('refuses floating point money', () =>
    expect(() => normalizeInvoice({ ...invoice, amount: 1250.0 })).toThrow());
  it('refuses impossible calendar dates', () =>
    expect(() => normalizeInvoice({ ...invoice, issued_on: '2026-02-30' })).toThrow());
  it('trims identifiers', () =>
    expect(normalizeInvoice({ ...invoice, vendor_id: ' V001 ' }).vendor_id).toBe('V001'));
  it('distinguishes composite keys containing delimiters', () =>
    expect(logicalId({ ...invoice, company_id: 'A:B', vendor_id: 'C' })).not.toBe(
      logicalId({ ...invoice, company_id: 'A', vendor_id: 'B:C' }),
    ));
  it('has stable operation identity and unique versions', () => {
    expect(operationId(logicalId(invoice), '1', 'upsert')).toBe(
      operationId(logicalId(invoice), '1', 'upsert'),
    );
    expect(operationId(logicalId(invoice), '1', 'upsert')).not.toBe(
      operationId(logicalId(invoice), '2', 'upsert'),
    );
  });
  it('preserves bigint ordering beyond JS safe integers', () => {
    expect(isStale('9007199254740992', '9007199254740993', null)).toBe(true);
    expect(isStale('9007199254740994', '9007199254740993', null)).toBe(false);
  });
  it('uses tombstones to prevent stale resurrection', () =>
    expect(isStale('43', '42', '44')).toBe(true));
  it('derives full-state create/update/delete', () => {
    expect(deriveChanges(new Map(), [invoice])[0].desired).toEqual(invoice);
    const previous = new Map([[logicalId(invoice), fingerprint(invoice)]]);
    expect(deriveChanges(previous, [invoice])).toEqual([]);
    expect(deriveChanges(previous, [{ ...invoice, amount: '1400.00' }])[0].desired?.amount).toBe(
      '1400.00',
    );
    expect(deriveChanges(previous, [])[0].action).toBe('delete');
  });
  it('normalizes the native ERP shape', () =>
    expect(
      fingerprint(
        fromERP({
          CO_CD: 'ACME',
          VND_NO: 'V001',
          INV_NO: 'INV-1001',
          JB_NO: 'J001',
          GROSS_AMT: '1250.00',
          CCY: 'USD',
          INV_DT: '2026-01-15',
          ST_CD: 'O',
        }),
      ),
    ).toBe(fingerprint(invoice)));
});
describe('untrusted workloads and optional acceleration', () => {
  it('refuses unknown references and duplicate business identity', () =>
    expect(validateInvoice(invoice, [], [], new Set([logicalId(invoice)]))).toEqual([
      'unknown_vendor',
      'unknown_or_inactive_job',
      'duplicate_invoice_business_key',
    ]));
  it('accepts known references', () =>
    expect(
      validateInvoice(
        invoice,
        [{ id: 'V001', company_id: 'ACME', name: 'Harbor Concrete' }],
        [{ id: 'J001', name: 'Harbor', active: true }],
        new Set(),
      ),
    ).toEqual([]));
  it('matches only exact echo fingerprints', () => {
    expect(isKnownWrite('same', 'same')).toBe(true);
    expect(isKnownWrite('changed', 'same')).toBe(false);
  });
  it('repeats the same seed and distinguishes another seed', () => {
    expect(plan(42)).toEqual(plan(42));
    expect(plan(42)).not.toEqual(plan(43));
  });
  it('never labels unexecuted invariants as passing', () =>
    expect(pendingResults().every((result) => result.passed === null)).toBe(true));
  it('Redis absence does not turn an optional cache into durable state', async () => {
    const redis = new RedisSupport();
    expect(await redis.get('missing')).toBe(null);
    await redis.notify();
    await redis.cache('key', { value: 1 }, 3);
    expect(await redis.allow('rate', 1, 1)).toBe(true);
    expect(redis.ready).toBe(false);
  });
});
