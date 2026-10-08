import { z } from 'zod';

const identifier = z.string().trim().min(1).max(120);
// Financial amounts remain decimal strings. Never round money through a JS Number.
export const invoiceSchema = z
  .object({
    company_id: identifier,
    vendor_id: identifier,
    invoice_number: identifier,
    job_id: identifier,
    amount: z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    issued_on: z.string().date(),
    status: z.enum(['open', 'paid', 'void']).default('open'),
  })
  .strict();
export type Invoice = z.infer<typeof invoiceSchema>;
// OpenAPI/Fastify documentation for the canonical invoice. Zod remains the domain parser.
export const invoiceBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'company_id',
    'vendor_id',
    'invoice_number',
    'job_id',
    'amount',
    'currency',
    'issued_on',
  ],
  properties: {
    company_id: { type: 'string', minLength: 1, maxLength: 120 },
    vendor_id: { type: 'string', minLength: 1, maxLength: 120 },
    invoice_number: { type: 'string', minLength: 1, maxLength: 120 },
    job_id: { type: 'string', minLength: 1, maxLength: 120 },
    amount: { type: 'string', pattern: '^(0|[1-9]\\d{0,15})(\\.\\d{1,2})?$' },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    issued_on: { type: 'string', format: 'date' },
    status: { type: 'string', enum: ['open', 'paid', 'void'] },
  },
} as const;
export interface Vendor {
  id: string;
  company_id: string;
  name: string;
}
export interface Job {
  id: string;
  name: string;
  active: boolean;
}
export type Action = 'upsert' | 'delete';
export interface Operation {
  operation_id: string;
  logical_id: string;
  version: string;
  action: Action;
  desired: Invoice | null;
  fingerprint: string | null;
  status: string;
  attempts: number;
  verification_outcome: string | null;
  error: string | null;
}
export interface AuditEvent {
  id: string;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
}
export interface Metrics {
  jobs: Record<string, number>;
  erp: string;
  pm: string;
  redis: string;
  last_complete_snapshot: string | null;
  last_successful_sync: string | null;
  drift_count: number;
  sync_lag_seconds: number;
}
export interface InvariantResult {
  name: string;
  passed: boolean | null;
  evidence: string;
}
export interface ChaosPlan {
  id: string;
  status: 'planned';
  seed: number;
  sequence: { step: number; fault: string }[];
  invariants: InvariantResult[];
}
