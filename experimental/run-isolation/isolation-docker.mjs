// THROWAWAY spike prototype (see docs/decisions/run-isolation.md): an executor
// decorator that starts each run's agent in its own Docker container. Not a
// product addon; nothing under bakers-cli/ imports it.
//
// The executor slot is a singleton (the last addon wins), so the decorator
// loads its inner executor itself from `with.inner` and rewrites only the
// launch command; every other method delegates.
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
// Claude Code keys a transcript directory by its cwd with every other character as '-'.
const transcriptKey = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');
// Only the model credential enters the run, never the operator home.
const CREDENTIALS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];

export function wrapRun(input, opts, where) {
  const ws = input.workspacePath;
  const env = { ...input.env };
  const key = transcriptKey(ws);
  const bind = (from, to = from, mode = '') => `-v ${q(from)}:${q(to)}${mode}`;
  const args = [
    'docker run --rm -it',
    `--name bb-run-${input.run.id}`,
    // shortcut: host network reaches the 127.0.0.1 tool server, but egress is open; upgrade to a bridge network plus allowlist proxy.
    '--network host',
    `--user ${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '-e HOME=/home/run',
    ...Object.keys(env).map((k) => `-e ${k}`),
    bind(ws),
    bind(where.gitCommonDir),
    ...(opts.mounts ?? []).map((m) => bind(m, m, ':ro')),
    bind(where.runHome, '/home/run'),
    bind(
      join(where.hostHome, '.claude/projects', key),
      `/home/run/.claude/projects/${key}`,
    ),
    `-w ${q(ws)}`,
    opts.image,
    `sh -c ${q(input.command ?? 'claude')}`,
  ];
  // Secrets stay in env: herdr writes `KEY=value` into its 0600 launch file, docker forwards `-e KEY`.
  return { ...input, env, command: args.join(' ') };
}

async function hostPaths(input) {
  const { stdout } = await run('git', [
    '-C', input.workspacePath, 'rev-parse', '--path-format=absolute', '--git-common-dir',
  ]);
  const hostHome = homedir();
  const runHome = join(hostHome, '.cache/bakers-isolation', input.run.uuid);
  mkdirSync(runHome, { recursive: true });
  mkdirSync(join(hostHome, '.claude/projects', transcriptKey(input.workspacePath)), {
    recursive: true,
  });
  return { gitCommonDir: stdout.trim(), runHome, hostHome };
}

export default function isolationDocker(opts = {}) {
  const image = opts.image ?? 'bakers-run-isolation:spike';
  const loadInner =
    opts.loadInner ??
    (async (config, deps) =>
      (await import(opts.inner)).default(opts.innerWith).createExecutor(config, deps));
  const docker = opts.docker ?? ((args) => run('docker', args));
  const where = opts.where ?? hostPaths;
  return {
    kind: 'executor',
    id: 'isolation-docker',
    requiredModules: [],
    async createExecutor(config, deps) {
      const inner = await loadInner(config, deps);
      return {
        id: `isolation-docker(${inner.id})`,
        capabilities: () => inner.capabilities(),
        ...(inner.openWorkspace
          ? { openWorkspace: (p, ctx) => inner.openWorkspace(p, ctx) }
          : {}),
        async startRun(input) {
          const creds = Object.fromEntries(
            CREDENTIALS.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
          );
          const withCreds = { ...input, env: { ...creds, ...input.env } };
          return inner.startRun(
            wrapRun(withCreds, { image, mounts: opts.mounts }, await where(input)),
          );
        },
        stopRun: (branch) => inner.stopRun(branch),
        async cleanupRun(branch, runId) {
          await inner.cleanupRun(branch, runId);
          // Closing the pane kills the docker client, not always the container.
          await docker(['rm', '-f', `bb-run-${runId}`]).catch(() => {});
        },
      };
    },
  };
}
