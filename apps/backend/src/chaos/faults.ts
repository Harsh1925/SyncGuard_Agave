export const faultPoints = [
  'BEFORE_EXTERNAL_WRITE',
  'AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION',
  'DURING_SNAPSHOT',
  'AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT',
  'DURING_RECONCILIATION',
] as const;
export type FaultPoint = (typeof faultPoints)[number];
export function hit(point: FaultPoint): void {
  if (process.env.ENABLE_FAULTS === 'true' && process.env.FAULT_POINT === point) process.exit(86);
}
