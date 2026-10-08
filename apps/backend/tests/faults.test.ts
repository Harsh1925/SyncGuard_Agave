import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { faultPoints } from '../src/chaos/faults.js';
it.each(faultPoints)('hard-exit boundary %s requires explicit opt-in', (point) => {
  const code = `import('./apps/backend/src/chaos/faults.ts').then(({hit})=>{hit('${point}');console.log('completed')})`;
  const env = { ...process.env, ENABLE_FAULTS: 'true', FAULT_POINT: point };
  expect(spawnSync(process.execPath, ['--import', 'tsx', '--eval', code], { env }).status).toBe(86);
  const disabled = spawnSync(process.execPath, ['--import', 'tsx', '--eval', code], {
    env: { ...env, ENABLE_FAULTS: 'false' },
  });
  expect(disabled.status).toBe(0);
  expect(disabled.stdout.toString()).toBe('completed\n');
});
