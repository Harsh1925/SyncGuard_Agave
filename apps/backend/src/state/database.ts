import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg, { type PoolClient } from 'pg';
export const createPool = (dsn: string): pg.Pool =>
  new pg.Pool({
    connectionString: dsn,
    max: 4,
    connectionTimeoutMillis: 5000,
    ssl: process.env.DATABASE_SSL_CA_FILE
      ? { ca: readFileSync(process.env.DATABASE_SSL_CA_FILE, 'utf8'), rejectUnauthorized: true }
      : undefined,
  });
export async function inTransaction<T>(client: PoolClient, action: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await action();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
export async function transaction<T>(
  pool: pg.Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool: pg.Pool): Promise<void> {
  const directory = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(91001)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount)
        continue;
      await client.query(await readFile(`${directory}/${name}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
  });
}
