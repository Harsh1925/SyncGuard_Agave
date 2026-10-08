import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ERPAdapter } from '../adapters/erp.js';
import { deriveChanges, fingerprint, logicalId } from '../domain/invoice.js';
import { inTransaction } from '../state/database.js';
import { audit, enqueueChange } from '../state/repository.js';
import { RedisSupport } from '../state/redis.js';
import { hit } from '../chaos/faults.js';

export class SnapshotDetector {
  constructor(
    private pool: pg.Pool,
    private erp: Pick<ERPAdapter, 'snapshot'>,
    private redis: RedisSupport,
  ) {}
  async run() {
    const client = await this.pool.connect();
    const id = randomUUID();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(91002)');
      locked = true;
      const previous =
        (
          await client.query(
            "SELECT id FROM snapshots WHERE status='COMPLETE' ORDER BY completed_at DESC LIMIT 1",
          )
        ).rows[0]?.id ?? null;
      await inTransaction(client, async () => {
        await client.query(
          "INSERT INTO snapshots(id,status,previous_complete_id) VALUES ($1,'IN_PROGRESS',$2)",
          [id, previous],
        );
        await audit(client, 'snapshot_started', null, { snapshot_id: id });
      });
      try {
        const invoices = await this.erp.snapshot();
        for (const _invoice of invoices) hit('DURING_SNAPSHOT');
        hit('AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT');
        const result = await inTransaction(client, async () => {
          const rows = (
            await client.query(
              'SELECT logical_id,fingerprint FROM snapshot_members WHERE snapshot_id=$1',
              [previous],
            )
          ).rows;
          const changes = deriveChanges(
            new Map(rows.map((row) => [row.logical_id, row.fingerprint])),
            invoices,
          );
          for (const invoice of invoices)
            await client.query(
              'INSERT INTO snapshot_members(snapshot_id,logical_id,fingerprint,state) VALUES ($1,$2,$3,$4)',
              [id, logicalId(invoice), fingerprint(invoice), JSON.stringify(invoice)],
            );
          await client.query(
            "UPDATE snapshots SET status='COMPLETE',completed_at=now() WHERE id=$1",
            [id],
          );
          const operations = [];
          for (const change of changes) operations.push(await enqueueChange(client, change));
          await audit(client, 'snapshot_completed', null, {
            snapshot_id: id,
            changes: changes.length,
          });
          await client.query(
            "DELETE FROM snapshots WHERE status='COMPLETE' AND NOT retained AND id NOT IN (SELECT id FROM snapshots WHERE status='COMPLETE' ORDER BY completed_at DESC LIMIT 5)",
          );
          return { snapshot_id: id, changes: changes.length, operations };
        });
        // Wake-up hint occurs AFTER durable commit. Losing it cannot lose a Postgres job.
        if (result.changes) await this.redis.notify();
        return result;
      } catch (error) {
        await inTransaction(client, async () => {
          await client.query(
            "UPDATE snapshots SET status='FAILED',completed_at=now(),error=$1 WHERE id=$2",
            [String(error), id],
          );
          await audit(client, 'snapshot_failed', null, { snapshot_id: id, error: String(error) });
        });
        throw error;
      }
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(91002)');
      } finally {
        client.release(true);
      } // Never return a possibly session-locked connection to the pool.
    }
  }
}
