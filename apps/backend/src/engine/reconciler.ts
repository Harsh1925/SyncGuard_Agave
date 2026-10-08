import type pg from 'pg';
import { ERPAdapter } from '../adapters/erp.js';
import { PMAdapter } from '../adapters/pm.js';
import { fingerprint } from '../domain/invoice.js';
import { logicalId } from '../domain/invoice.js';
import { audit } from '../state/repository.js';
import { inTransaction } from '../state/database.js';
import { hit } from '../chaos/faults.js';

export class Reconciler {
  constructor(
    private pool: pg.Pool,
    private erp: ERPAdapter,
    private pm: PMAdapter,
  ) {}
  async run() {
    const client = await this.pool.connect();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(91002)');
      locked = true;
      const authoritative = new Map(
        (await this.erp.snapshot()).map((invoice) => [logicalId(invoice), invoice]),
      );
      const replica = await this.pm.invoices();
      const open = (
        await client.query('SELECT logical_id FROM drift_reports WHERE resolved_at IS NULL')
      ).rows.map((row) => row.logical_id as string);
      const drift: string[] = [];
      const deferred: string[] = [];
      for (const key of [
        ...new Set([...authoritative.keys(), ...replica.keys(), ...open]),
      ].sort()) {
        hit('DURING_RECONCILIATION');
        await inTransaction(client, async () => {
          const recordLocked = (
            await client.query(
              'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',
              [key],
            )
          ).rows[0].locked;
          const active = (
            await client.query(
              "SELECT 1 FROM operations WHERE logical_id=$1 AND status IN ('pending','attempting','retrying') LIMIT 1",
              [key],
            )
          ).rowCount;
          if (!recordLocked || active) {
            deferred.push(key);
            await audit(client, 'reconciliation_deferred', null, { logical_id: key });
            return;
          }
          // Re-read under the worker's record fence; initial PM listing may already be stale.
          const source = authoritative.get(key) ?? null;
          const target = (await this.pm.get(key))?.invoice ?? null;
          if ((source ? fingerprint(source) : null) !== (target ? fingerprint(target) : null)) {
            drift.push(key);
            await client.query(
              `INSERT INTO drift_reports(logical_id,authoritative,replica) VALUES ($1,$2,$3)
              ON CONFLICT(logical_id) WHERE resolved_at IS NULL DO UPDATE SET authoritative=EXCLUDED.authoritative,replica=EXCLUDED.replica,detected_at=now()`,
              [key, source ? JSON.stringify(source) : null, target ? JSON.stringify(target) : null],
            );
            await audit(client, 'drift_detected', null, { logical_id: key });
          } else
            await client.query(
              'UPDATE drift_reports SET resolved_at=now() WHERE logical_id=$1 AND resolved_at IS NULL',
              [key],
            );
        });
      }
      return { drift, deferred };
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(91002)');
      } finally {
        client.release(true);
      }
    }
  }
}
