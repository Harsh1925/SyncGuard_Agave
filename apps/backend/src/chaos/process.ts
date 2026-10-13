import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Settings } from '../config.js';
export async function childCommand(settings: Settings, command: string, fault = '') {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../cli.ts', import.meta.url)), command],
      {
        env: {
          ...process.env,
          DATABASE_URL: settings.DATABASE_URL,
          PM_URL: settings.PM_URL,
          LEASE_SECONDS: '1',
          ENABLE_FAULTS: fault ? 'true' : 'false',
          FAULT_POINT: fault,
        },
        stdio: 'inherit',
      },
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Fault child exceeded 20 seconds'));
    }, 20000);
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}
