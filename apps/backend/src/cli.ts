import { setTimeout as sleep } from 'node:timers/promises';
import { loadSettings } from './config.js';
import { createPool, migrate } from './state/database.js';
import { RedisSupport } from './state/redis.js';
import { ERPAdapter } from './adapters/erp.js';
import { PMAdapter } from './adapters/pm.js';
import { SnapshotDetector } from './engine/detector.js';
import { SyncWorker } from './engine/worker.js';
import { Reconciler } from './engine/reconciler.js';
import { seed, buildERP } from './simulators/erp.js';
import { buildPM } from './simulators/pm.js';
import { buildApi } from './api/app.js';
import { plan } from './chaos/planner.js';
import { demoEnabled } from './chaos/simulator.js';
import { runChaos } from './chaos/runner.js';
import { runDemo } from './demo/runner.js';

const command = process.argv[2] ?? 'api';
const settings = loadSettings();
const pool = createPool(settings.DATABASE_URL);
const redis = new RedisSupport();
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
try {
  if (['api', 'pm', 'worker', 'poll', 'poll-loop'].includes(command))
    await redis.connect(settings.REDIS_URL);
  const erp = new ERPAdapter(pool, demoEnabled(settings.DATABASE_URL));
  const pm = new PMAdapter(settings.PM_URL);
  if (['migrate', 'bootstrap'].includes(command)) await migrate(pool);
  if (['seed', 'bootstrap'].includes(command)) await seed(pool);
  if (['api', 'erp', 'pm'].includes(command)) {
    const app =
      command === 'api'
        ? await buildApi(pool, settings, redis)
        : command === 'erp'
          ? await buildERP(pool)
          : await buildPM(pool, redis, demoEnabled(settings.DATABASE_URL));
    await app.listen({
      host: process.env.HOST ?? '127.0.0.1',
      port: Number(
        process.env.PORT ?? ({ api: 8000, erp: 8001, pm: 8002 } as Record<string, number>)[command],
      ),
    });
    await new Promise<void>((resolve) =>
      stop.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    await app.close();
  } else if (command === 'worker')
    await new SyncWorker(pool, settings, pm, redis).runForever(stop.signal);
  else if (command === 'worker-once')
    console.log(await new SyncWorker(pool, settings, pm, redis).runOnce());
  else if (command === 'chaos-run') await runChaos(pool, settings, redis, process.argv[3]);
  else if (command === 'demo') await runDemo(pool, settings, redis, Number(process.argv[3] ?? 42));
  else if (command === 'poll')
    console.log(JSON.stringify(await new SnapshotDetector(pool, erp, redis).run()));
  else if (command === 'poll-loop') {
    while (!stop.signal.aborted) {
      try {
        console.log(JSON.stringify(await new SnapshotDetector(pool, erp, redis).run()));
      } catch (error) {
        console.error('Snapshot failed; no destructive inference', error);
      }
      await sleep(settings.POLL_SECONDS * 1000);
    }
  } else if (command === 'reconcile')
    console.log(JSON.stringify(await new Reconciler(pool, erp, pm).run()));
  else if (command === 'chaos-plan')
    console.log(
      JSON.stringify(
        {
          status: 'planned',
          seed: Number(process.argv[3] ?? 42),
          sequence: plan(Number(process.argv[3] ?? 42)),
        },
        null,
        2,
      ),
    );
  else if (!['migrate', 'seed', 'bootstrap'].includes(command))
    throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await redis.close();
  await pool.end();
}
