import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const planPath = process.argv[2];
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
// The executor's shell can carry unrelated secrets; only declared run keys enter bwrap.
const env = Object.fromEntries(
  plan.envKeys
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
writeFileSync(`${planPath}.pid`, String(process.pid), { mode: 0o600 });
const child = spawn(plan.bwrap, plan.argv, { env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
child.on('error', (err) => {
  console.error(`runtime-bwrap: ${err.message}`);
  process.exitCode = 1;
  rmSync(`${planPath}.pid`, { force: true });
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
  rmSync(`${planPath}.pid`, { force: true });
});
