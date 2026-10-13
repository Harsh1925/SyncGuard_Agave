import type pg from 'pg';
import { z } from 'zod';
export const simulatorFaultSchema = z
  .object({
    target: z.enum(['erp', 'pm']),
    kind: z.enum([
      'none',
      'latency',
      'partial_read',
      'lost_response',
      'transient_failure',
      'rate_limit',
    ]),
    remaining: z.number().int().min(0).max(100).default(1),
    delay_ms: z.number().int().min(0).max(10000).default(0),
    fail_after: z.number().int().min(0).default(1),
  })
  .strict()
  .refine(
    (v) =>
      v.target !== 'erp' ||
      ['none', 'latency', 'partial_read', 'transient_failure'].includes(v.kind),
    'Unsupported ERP fault',
  );
export function demoEnabled(url: string, enabled: string = process.env.DEMO_CONTROLS ?? 'false') {
  return enabled === 'true' && new URL(url).pathname === '/syncguard_demo';
}
export async function setFault(pool: pg.Pool, raw: unknown) {
  const f = simulatorFaultSchema.parse(raw);
  await pool.query(
    `INSERT INTO simulator_faults(target,kind,remaining,delay_ms,fail_after)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT(target) DO UPDATE SET kind=EXCLUDED.kind,
    remaining=EXCLUDED.remaining,delay_ms=EXCLUDED.delay_ms,fail_after=EXCLUDED.fail_after`,
    [f.target, f.kind, f.remaining, f.delay_ms, f.fail_after],
  );
  return f;
}
export async function consumeFault(pool: pg.Pool, target: string) {
  return (
    await pool.query(
      `UPDATE simulator_faults SET remaining=remaining-1
    WHERE target=$1 AND remaining>0 AND kind<>'none' RETURNING kind,delay_ms,fail_after`,
      [target],
    )
  ).rows[0] as { kind: string; delay_ms: number; fail_after: number } | undefined;
}
