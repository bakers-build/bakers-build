// THROWAWAY: start an isolated run through the REAL herdr executor (tab, launch script, 4 s
// launch watch, cleanupRun) and report what the run saw. Run from the worktree root, in a shell
// that reaches the herdr server:
//   node experimental/run-isolation/herdr-probe.mjs docker   # through the isolation-docker decorator
//   node experimental/run-isolation/herdr-probe.mjs sbx      # `sbx exec -it` into sandbox bb-herdr
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import herdrExecutor from '../../bakers-cli/addons/herdr/dist/src/index.js';
import isolationDocker from './isolation-docker.mjs';

const backend = process.argv[2] ?? 'docker';
const ws = resolve(new URL('../..', import.meta.url).pathname);
const here = join(ws, 'experimental/run-isolation');
const sh = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
const git = (...a) => execFileSync('git', ['-C', ws, ...a], { encoding: 'utf8' }).trim();
const branch = git('branch', '--show-current');
const out = join(ws, 'assets-ai/BAKERS-155', `herdr-probe-${backend}.txt`);
mkdirSync(join(ws, 'assets-ai/BAKERS-155'), { recursive: true });
rmSync(out, { force: true });

const config = { config_path: join(ws, '.bakers/conductor.config.js') };
const deps = { logger: console };
const runId = 900000 + Math.floor(Math.random() * 99999);
const token = `probe-${runId}`;
const env = { BB_CONDUCTOR_TOKEN: token, OUT: out };
let command = `sh ${sh(join(here, 'in-run.sh'))}`;
let standin;
let executor;

if (backend === 'docker') {
  const port = 20000 + (runId % 10000);
  standin = spawn('node', [join(here, 'mcp-standin.mjs'), String(port), token], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2000));
  env.MCP_URL = `http://127.0.0.1:${port}/`;
  executor = await isolationDocker({
    loadInner: (c, d) => herdrExecutor().createExecutor(c, d),
  }).createExecutor(config, deps);
} else {
  const gitDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  try {
    execFileSync('sbx', ['rm', '-f', 'bb-herdr'], { stdio: 'ignore' }); // fails when absent
  } catch {}
  execFileSync('sbx', ['create', '--no-input', '--no-progress', '--name', 'bb-herdr', 'claude', ws, gitDir], {
    stdio: 'inherit',
  });
  // In the sandbox the MCP gateway answers at $MCP_GATEWAY_URL; no token goes in.
  command = `sbx exec -it -w ${sh(ws)} -e OUT=${sh(out)} bb-herdr ${command}`;
  executor = await herdrExecutor().createExecutor(config, deps);
}

const input = {
  ticket: { uuid: 'probe', identifier: 'BAKERS-155', title: 'isolation probe', branchName: branch, state: 'probe' },
  run: { uuid: `probe-${runId}`, id: runId, handler: 'probe' },
  workspacePath: ws,
  instructions: null,
  command,
  env,
};

const t0 = Date.now();
try {
  await executor.startRun(input);
  console.log(`startRun returned after ${Date.now() - t0} ms (launch watch passed)`);
  for (let i = 0; i < 120 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 500));
  console.log(existsSync(out) ? readFileSync(out, 'utf8') : 'NO REPORT from the run within 60 s');
} catch (err) {
  console.log(`startRun FAILED after ${Date.now() - t0} ms: ${err.message}`);
} finally {
  await executor.cleanupRun(branch, runId);
  console.log(`cleanupRun done (tab #${runId} closed)`);
  standin?.kill();
  if (backend === 'sbx') {
    try {
      execFileSync('sbx', ['rm', '-f', 'bb-herdr'], { stdio: 'ignore' });
    } catch {}
  }
}
