import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
const seed = Number(process.argv[2] ?? 42);
const steps = Number(process.argv[3] ?? 20);
const base = 'http://127.0.0.1:8100';
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail ?? `HTTP ${response.status}`);
  return body;
}
if (!(await request('/capabilities')).demo_controls)
  throw new Error('Start the isolated demo with npm run demo first');
const { id } = await request('/chaos/runs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ seed, steps }),
});
for (let attempt = 0; attempt < 600; attempt++) {
  const run = await request(`/chaos/runs/${id}`);
  if (['completed', 'failed'].includes(run.status)) {
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/chaos-report.json', JSON.stringify(run, null, 2) + '\n');
    if (run.status === 'failed')
      throw new Error(run.operation_counts.error ?? 'Chaos assertions failed');
    console.log(
      `PASS run ${id}: ${run.operation_counts.evidence.length} executed boundaries and seeded steps`,
    );
    console.log('Saved artifacts/chaos-report.json');
    break;
  }
  if (attempt === 599)
    throw new Error(`Run ${id} exceeded recording deadline; inspect persisted status`);
  await sleep(1000);
}
