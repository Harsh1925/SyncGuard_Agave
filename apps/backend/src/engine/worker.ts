import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import type { Operation } from '@syncguard/contracts';
import type { Settings } from '../config.js';
import { UpstreamError } from '../adapters/pm.js';
import { hit } from '../chaos/faults.js';
import { isStale } from '../domain/invoice.js';
import { inTransaction, transaction } from '../state/database.js';
import { audit, claim, finishJob, getOperation } from '../state/repository.js';
import { RedisSupport } from '../state/redis.js';

export interface Destination {
  verify(operation: Operation): Promise<boolean>;
  write(operation: Operation): Promise<void>;
}
export class SyncWorker {
  private id = randomUUID();
  constructor(
    private pool: pg.Pool,
    private settings: Settings,
    private destination: Destination,
    private redis: RedisSupport,
  ) {}
  async runOnce(): Promise<boolean> {
    const job = await transaction(this.pool, (client) =>
      claim(client, this.id, this.settings.LEASE_SECONDS),
    );
    if (!job) return false;
    const client = await this.pool.connect();
    let key: string | null = null;
    let locked = false;
    try {
      let operation = await getOperation(client, job.operation_id);
      key = operation.logical_id;
      locked = (
        await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key])
      ).rows[0].locked;
      if (!locked) {
        await finishJob(client, job, 'retrying', 'record owned by another worker', 1);
        return true;
      }
      operation = await getOperation(client, job.operation_id);
      const record = (await client.query('SELECT * FROM records WHERE logical_id=$1', [key]))
        .rows[0];
      if (['succeeded', 'suppressed'].includes(operation.status)) {
        await inTransaction(client, async () => {
          await finishJob(client, job, 'succeeded');
          await audit(client, 'duplicate_suppressed', operation.operation_id);
        });
        return true;
      }
      if (
        isStale(operation.version, record.applied_version, record.tombstone_version) ||
        BigInt(operation.version) < BigInt(record.observed_version)
      ) {
        await inTransaction(client, async () => {
          await client.query(
            "UPDATE operations SET status='suppressed',completed_at=now() WHERE operation_id=$1",
            [operation.operation_id],
          );
          await finishJob(client, job, 'succeeded');
          await audit(client, 'stale_suppressed', operation.operation_id, {
            version: operation.version,
          });
        });
        return true;
      }
      try {
        await inTransaction(client, async () => {
          await client.query(
            "UPDATE operations SET status='attempting',attempts=attempts+1 WHERE operation_id=$1",
            [operation.operation_id],
          );
          await audit(client, 'write_requested', operation.operation_id);
        }); // Local intent is committed before the external write.
        const verified = await this.destination.verify(operation);
        await audit(client, 'destination_verified', operation.operation_id, { matched: verified });
        if (!verified) {
          hit('BEFORE_EXTERNAL_WRITE');
          await this.destination.write(operation);
          hit('AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION');
          if (!(await this.destination.verify(operation)))
            throw new Error('Destination write did not verify');
        }
        await inTransaction(client, async () => {
          await client.query(
            `UPDATE records SET applied_version=$1,applied_fingerprint=$2,pm_id=$3,
            tombstone_version=CASE WHEN $4::text='delete' THEN $1::bigint ELSE tombstone_version END,updated_at=now() WHERE logical_id=$3::uuid`,
            [operation.version, operation.fingerprint, key, operation.action],
          );
          await client.query(
            "UPDATE operations SET status='succeeded',verification_outcome=$1,destination_reference=$2,error=NULL,completed_at=now() WHERE operation_id=$3",
            [verified ? 'already_committed' : 'verified_after_write', key, operation.operation_id],
          );
          await finishJob(client, job, 'succeeded');
          await audit(client, 'write_succeeded', operation.operation_id);
          if (operation.action === 'delete')
            await audit(client, 'tombstone_created', operation.operation_id, {
              version: operation.version,
            });
        });
      } catch (error) {
        const retryable =
          !(error instanceof UpstreamError) ||
          [408, 429].includes(error.status) ||
          error.status >= 500;
        const status =
          retryable && job.attempts < this.settings.MAX_ATTEMPTS ? 'retrying' : 'failed';
        await inTransaction(client, async () => {
          if (
            await finishJob(client, job, status, String(error), Math.min(2 ** job.attempts, 30))
          ) {
            await client.query('UPDATE operations SET status=$1,error=$2 WHERE operation_id=$3', [
              status,
              String(error),
              operation.operation_id,
            ]);
            await audit(
              client,
              status === 'retrying' ? 'write_retrying' : 'write_failed',
              operation.operation_id,
              { error: String(error) },
            );
          }
        });
      }
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
      } finally {
        client.release(true);
      }
    }
    return true;
  }
  async runForever(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        if (!(await this.runOnce())) await this.redis.wait();
      } catch (error) {
        console.error('Worker iteration failed; lease remains recoverable', error);
        await sleep(1000);
      }
    }
  }
}
