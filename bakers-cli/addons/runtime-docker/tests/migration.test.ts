import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { dockerRuntime } from '../src/backend.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bb-docker-neutral-'));
  roots.push(root);
  const ws = join(root, 'tree'),
    common = join(root, 'main/.git');
  const calls: string[][] = [];
  for (const path of [
    ws,
    common,
    join(common, 'worktrees/tree'),
    join(root, 'plugins'),
    join(root, 'transcripts'),
  ])
    mkdirSync(path, { recursive: true });
  const runtime = dockerRuntime(options, {
    exec: async (file, args) => {
      calls.push([file, ...args]);
      if (file === 'git')
        return {
          stdout: args.includes('--git-common-dir')
            ? common
            : join(common, 'worktrees/tree'),
        };
      if (args[0] === 'image') throw new Error('missing image');
      if (args[0] === 'network' && args.includes('--format'))
        return { stdout: '172.20.0.1' };
      if (args.includes('{{range .IPAM.Config}}{{.Gateway}}{{end}}'))
        return { stdout: '172.20.0.1' };
      return { stdout: '' };
    },
    env: {
      XDG_CACHE_HOME: join(root, 'cache'),
      HOME: join(root, 'home'),
      MODEL_TOKEN: 'secret',
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    cliRoot: '/opt/cli',
    packageDir: '/pkg',
    version: 'v1',
  });
  const metadata = {
    installCommand: 'install-generic-agent',
    modelApi: {
      target: 'https://api.example',
      baseUrlEnv: 'MODEL_URL',
      keyEnv: 'MODEL_KEY',
      auth: { MODEL_TOKEN: { set: { authorization: 'Bearer {value}' } } },
      credentialHint: 'set MODEL_TOKEN',
    },
  };
  const run = { uuid: 'neutral-run', id: 1 };
  return { root, ws, common, calls, runtime, metadata, run };
}

it('uses neutral installation and prepared paths without an agent-specific adapter', async () => {
  const f = fixture();
  expect(f.runtime.prepareRun).toBeTypeOf('function');
  const context = await f.runtime.prepareRun!(f.run, f.metadata);
  const out = await f.runtime.wrap({
    command: 'generic-agent',
    env: { ...context.env, AGENT_DIR: join(context.homePath, '.agent') },
    workspacePath: f.ws,
    run: f.run,
    harness: 'generic',
    ...f.metadata,
    ...context,
    readPaths: [join(f.root, 'plugins')],
    writePaths: [join(f.root, 'transcripts')],
  });
  expect(out.command).toContain(`${context.homePath}:${context.homePath}`);
  expect(out.command).toContain(
    `${join(f.root, 'plugins')}:${join(f.root, 'plugins')}:ro`,
  );
  expect(out.command).toContain(
    `${join(f.root, 'transcripts')}:${join(f.root, 'transcripts')}`,
  );
  expect(out.env.MODEL_TOKEN).toBe('secret');
  expect(out.command).not.toContain('secret');
  expect(
    f.calls.some((args) =>
      args.includes('AGENT_INSTALL=install-generic-agent'),
    ),
  ).toBe(true);
});

it('prepares only a placeholder credential in allowlist mode', async () => {
  const f = fixture({ network: 'allowlist' });
  expect(f.runtime.prepareRun).toBeTypeOf('function');
  const context = await f.runtime.prepareRun!(f.run, f.metadata);
  expect(context.env).toEqual({ MODEL_KEY: 'bb-runtime-placeholder' });
  expect(JSON.stringify(context)).not.toContain('secret');
});

it('checks an operator image without requiring installation or model API metadata', async () => {
  const f = fixture({ image: 'operator-image' });
  expect(f.runtime.prepareRun).toBeTypeOf('function');
  const context = await f.runtime.prepareRun!(f.run, {});
  // Missing operator images must fail without an automatic build.
  const depsExec = f.calls;
  await expect(
    f.runtime.wrap({
      command: 'true',
      env: {},
      workspacePath: f.ws,
      run: f.run,
      harness: 'generic',
      ...context,
    }),
  ).rejects.toThrow(/image operator-image is not available/);
  expect(depsExec.some((args) => args[1] === 'build')).toBe(false);
});

it('refuses prepared grants that reopen protected Git metadata or the host home', async () => {
  const f = fixture();
  const context = await f.runtime.prepareRun!(f.run, f.metadata);
  const input = {
    command: 'true',
    env: {},
    workspacePath: f.ws,
    run: f.run,
    harness: 'generic',
    ...f.metadata,
    ...context,
  };
  await expect(
    f.runtime.wrap({ ...input, writePaths: [f.common] }),
  ).rejects.toThrow(/protected/);
  await expect(
    f.runtime.wrap({ ...input, readPaths: [f.root] }),
  ).rejects.toThrow(/broad/);
});
