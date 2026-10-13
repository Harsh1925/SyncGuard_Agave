import { spawn } from 'node:child_process';
async function run(command: string, args: string[], env = process.env) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env, shell: false });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
const compose = ['compose', '-p', 'syncguard-test', '-f', 'compose.test.yaml'];
try {
  await run('docker', [...compose, 'up', '--wait', '-d']);
  await run('npm', ['test'], {
    ...process.env,
    TEST_DATABASE_URL: 'postgresql://syncguard:syncguard@localhost:55432/syncguard_test',
    TEST_REDIS_URL: 'redis://localhost:56379',
  });
} finally {
  await run('docker', [...compose, 'down']);
}
