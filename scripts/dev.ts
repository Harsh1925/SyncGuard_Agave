import { spawn } from 'node:child_process';
// Argument arrays avoid shell quoting and command interpolation in the dev launcher.
const children = ['@syncguard/backend', '@syncguard/dashboard'].map((workspace) =>
  spawn('npm', ['run', 'dev', '-w', workspace], { stdio: 'inherit', shell: false }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
for (const child of children) {
  child.once('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.once('exit', (code) => stop(code ?? 1));
}
