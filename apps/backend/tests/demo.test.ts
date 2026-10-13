import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { runDemo } from '../src/demo/runner.js';
import { loadSettings } from '../src/config.js';
import { RedisSupport } from '../src/state/redis.js';
const forbiddenPool = {
  connect: () => {
    throw new Error('No database access allowed');
  },
} as unknown as pg.Pool;
describe('Demo isolation', () => {
  it('refuses the normal application database before opening a connection', async () => {
    await expect(runDemo(forbiddenPool, loadSettings({}), new RedisSupport())).rejects.toThrow(
      'Demo requires the separate syncguard_demo database',
    );
  });
  it('refuses an invalid seed before opening a connection', async () => {
    await expect(
      runDemo(
        forbiddenPool,
        loadSettings({
          DATABASE_URL: 'postgresql://localhost/syncguard_demo',
        }),
        new RedisSupport(),
        -1,
      ),
    ).rejects.toThrow('Invalid chaos seed or steps');
  });
});
