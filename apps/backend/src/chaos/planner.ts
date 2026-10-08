import type { InvariantResult } from '@syncguard/contracts';
const faults = [
  'lost_response',
  'transient_failure',
  'duplicate_delivery',
  'concurrent_delivery',
  'out_of_order',
  'crash_after_commit',
  'incomplete_snapshot',
  'rate_limit',
];
export function plan(seed: number, steps = 20) {
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isInteger(steps) ||
    steps < 1 ||
    steps > 1000
  )
    throw new Error('Invalid chaos seed or steps');
  let state = seed >>> 0;
  // Explicit 32-bit PRNG rather than Math.random: reproducible independently of wall time.
  return Array.from({ length: steps }, (_, step) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return { step, fault: faults[Math.floor((state / 2 ** 32) * faults.length)] };
  });
}
export function pendingResults(): InvariantResult[] {
  return [
    'idempotent_financial_effect',
    'no_silent_loss',
    'monotonic_record_state',
    'safe_observation',
    'observable_convergence',
  ].map((name) => ({
    name,
    passed: null,
    evidence: 'Not executed: scenario runner remains a scaffold extension',
  }));
}
