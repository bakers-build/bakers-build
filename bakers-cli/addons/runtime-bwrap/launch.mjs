import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const planPath = process.argv[2];
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
// The executor's shell can carry unrelated secrets; only declared run keys and the
// pane's terminal and locale variables (no secrets, needed for colour and redraw) enter bwrap.
const TERMINAL =
  /^(TERM|COLORTERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|LANG|LANGUAGE|LC_[A-Z_]+|NO_COLOR|FORCE_COLOR)$/;
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined && (plan.envKeys.includes(key) || TERMINAL.test(key)),
  ),
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
