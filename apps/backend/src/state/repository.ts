import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Operation } from '@syncguard/contracts';
import { operationId, type Change } from '../domain/invoice.js';

export async function audit(
  client: PoolClient,
  event: string,
  operation: string | null = null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await client.query('INSERT INTO audit_events(operation_id,event,detail) VALUES ($1,$2,$3)', [
    operation,
    event,
    JSON.stringify(detail),
  ]);
}
export async function enqueueChange(client: PoolClient, change: Change): Promise<string> {
  const { rows } = await client.query("SELECT nextval('observation_version')::text AS version");
  const version: string = rows[0].version;
  if (change.desired) {
    const { company_id, vendor_id, invoice_number } = change.desired;
    const identity = JSON.stringify({ company_id, vendor_id, invoice_number });
    await client.query(
      `INSERT INTO records(logical_id,erp_identity,business_key,observed_version,observed_fingerprint,observed_state)
      VALUES ($1,$2,$2,$3,$4,$5) ON CONFLICT(logical_id) DO UPDATE SET observed_version=EXCLUDED.observed_version,
      observed_fingerprint=EXCLUDED.observed_fingerprint,observed_state=EXCLUDED.observed_state,updated_at=now()`,
      [change.logicalId, identity, version, change.fingerprint, JSON.stringify(change.desired)],
    );
  } else
    await client.query(
      'UPDATE records SET observed_version=$1,observed_state=NULL,observed_fingerprint=NULL,updated_at=now() WHERE logical_id=$2',
      [version, change.logicalId],
    );
  const op = operationId(change.logicalId, version, change.action);
  await client.query(
    'INSERT INTO operations(operation_id,logical_id,version,action,desired,fingerprint) VALUES ($1,$2,$3,$4,$5,$6)',
    [
      op,
      change.logicalId,
      version,
      change.action,
      change.desired ? JSON.stringify(change.desired) : null,
      change.fingerprint,
    ],
  );
  await client.query('INSERT INTO jobs(operation_id) VALUES ($1)', [op]);
  await audit(client, 'change_detected', op, { action: change.action, version });
  await audit(client, 'job_queued', op);
  return op;
}
export interface ClaimedJob {
  id: string;
  operation_id: string;
  claim_token: string;
  attempts: number;
  previous_status: string;
}
export async function claim(
  client: PoolClient,
  worker: string,
  lease: number,
): Promise<ClaimedJob | null> {
  const result = await client.query<ClaimedJob>(
    `WITH candidate AS (
    SELECT id,status FROM jobs WHERE (status IN ('pending','retrying') AND available_at<=now())
      OR (status='claimed' AND lease_until<now()) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE jobs j SET status='claimed',claimed_by=$1,claim_token=$2,
      lease_until=now()+$3*interval '1 second',attempts=attempts+1 FROM candidate c
      WHERE j.id=c.id RETURNING j.*,c.status AS previous_status`,
    [worker, randomUUID(), lease],
  );
  const job = result.rows[0] ?? null;
  if (job)
    await audit(
      client,
      job.previous_status === 'claimed' ? 'job_reclaimed' : 'job_claimed',
      job.operation_id,
      { worker, job_id: job.id },
    );
  return job;
}
export async function finishJob(
  client: PoolClient,
  job: ClaimedJob,
  status: string,
  error: string | null = null,
  delay = 0,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE jobs SET status=$1,error=$2,lease_until=NULL,claimed_by=NULL,claim_token=NULL,
    available_at=now()+$3*interval '1 second' WHERE id=$4 AND claim_token=$5 RETURNING id`,
    [status, error, delay, job.id, job.claim_token],
  );
  return (result.rowCount ?? 0) > 0;
}
export async function getOperation(client: PoolClient, id: string): Promise<Operation> {
  const { rows } = await client.query<Operation>('SELECT * FROM operations WHERE operation_id=$1', [
    id,
  ]);
  if (!rows[0]) throw new Error('Operation missing from durable ledger');
  return rows[0];
}
