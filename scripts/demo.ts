import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const seed = process.argv[2] ?? '42';
if (!/^\d+$/.test(seed) || Number(seed) > 0xffffffff)
  throw new Error('Use an integer seed from 0 to 4294967295');
const prefix = ['compose', '-p', 'syncguard-demo', '-f', 'compose.demo.yaml'];
async function docker(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', [...prefix, ...args], { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Docker exited ${code}`)),
    );
  });
}
await docker(['up', '--build', '-d']);
await docker([
  'run',
  '--build',
  '--rm',
  'demo',
  './node_modules/.bin/tsx',
  'apps/backend/src/cli.ts',
  'demo',
  seed,
]);
const response = await fetch('http://127.0.0.1:8100/demo/runs', {
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw new Error('Unable to retrieve recorded demo evidence');
const reports = (await response.json()) as { status: string; seed: string | number }[];
const report = reports[0];
if (!report || report.status !== 'completed' || Number(report.seed) !== Number(seed))
  throw new Error('Latest persisted demo result does not match this successful run');
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/demo-report.json', JSON.stringify(report, null, 2) + '\n');
console.log('Saved artifacts/demo-report.json');
console.log(
  'Open http://localhost:8180 for operation timelines; recorded proof: http://localhost:8100/demo/runs',
);
