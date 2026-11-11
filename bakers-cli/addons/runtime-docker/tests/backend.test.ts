import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConductorLogger } from '@bakers-build/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { type BackendDeps, dockerRuntime } from '../src/backend.js';

type Call = [string, string[]];

let root: string;
let ws: string;
let common: string;
let agentHome: string;
let cache: string;
let calls: Call[];
let warnings: string[];

const logger: ConductorLogger = {
  debug: () => {},
  info: () => {},
  warn: (_o: object, msg?: string) => warnings.push(msg ?? ''),
  error: () => {},
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bb-runtime-'));
  ws = join(root, 'tree');
  common = join(root, 'main/.git');
  agentHome = join(root, 'agent');
  cache = join(root, 'cache');
  for (const d of [ws, common, join(common, 'worktrees/tree'), agentHome])
    mkdirSync(d, { recursive: true });
  writeFileSync(join(agentHome, 'settings.json'), '{"s":1}');
  writeFileSync(join(agentHome, '.claude.json'), '{"c":1}');
  writeFileSync(join(agentHome, '.credentials.json'), '{"secret":1}');
  calls = [];
  warnings = [];
});

function deps(over: Partial<BackendDeps> = {}): BackendDeps {
  return {
    exec: async (file, args) => {
      calls.push([file, args]);
      if (file === 'git' && args.includes('--git-common-dir'))
        return { stdout: `${common}\n` };
      if (file === 'git' && args.includes('--git-dir'))
        return { stdout: `${join(common, 'worktrees/tree')}\n` };
      return { stdout: '' };
    },
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth', XDG_CACHE_HOME: cache },
    logger,
    cliRoot: '/opt/cli',
    packageDir: '/pkg',
    version: '1.2.3',
    ...over,
  };
}

const launch = (over: Record<string, unknown> = {}) => ({
  command: 'claude --go',
  env: { CLAUDE_CONFIG_DIR: agentHome, BAKERS_CONDUCTOR_TOKEN: 'tok' },
  workspacePath: ws,
  run: { uuid: 'r-uuid', id: 7 },
  harness: 'claude',
  ...over,
});

describe('runtime-docker wrap', () => {
  it('prepares the run home without the credentials file', async () => {
    const rt = dockerRuntime({}, deps());
    const out = await rt.wrap(launch());
    const home = join(cache, 'bakers/runtime/r-uuid');
    expect(readFileSync(join(home, '.claude/settings.json'), 'utf8')).toBe(
      '{"s":1}',
    );
    expect(existsSync(join(home, '.claude/.claude.json'))).toBe(true);
    expect(existsSync(join(home, '.claude/.credentials.json'))).toBe(false);
    expect(existsSync(join(common, 'hooks'))).toBe(true);
    expect(out.command).toMatch(/^'?docker'? 'run'/);
    expect(out.command).toContain(`'${home}:/home/run'`);
    expect(out.command).not.toContain('oauth');
    expect(out.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth');
  });

  it('refuses without a model credential', async () => {
    const rt = dockerRuntime({}, deps({ env: { XDG_CACHE_HOME: cache } }));
    await expect(rt.wrap(launch())).rejects.toThrow(/claude setup-token/);
  });

  it('refuses a non-Claude harness on the default image', async () => {
    await expect(
      dockerRuntime({}, deps()).wrap(launch({ harness: 'codex' })),
    ).rejects.toThrow(/codex/);
    await expect(
      dockerRuntime({ image: 'mine' }, deps()).wrap(
        launch({ harness: 'codex' }),
      ),
    ).resolves.toBeDefined();
  });

  it('builds the default image once when missing', async () => {
    const d = deps({
      exec: async (file, args) => {
        calls.push([file, args]);
        if (args[0] === 'image') throw new Error('No such image');
        return deps()
          .exec(file, args)
          .then((r) => (calls.pop(), r));
      },
    });
    const rt = dockerRuntime({}, d);
    await rt.wrap(launch());
    await rt.wrap(launch({ run: { uuid: 'r-2', id: 8 } }));
    const builds = calls.filter(([, a]) => a[0] === 'build');
    expect(builds).toEqual([
      ['docker', ['build', '-t', 'bakers-runtime:1.2.3', '/pkg/image']],
    ]);
  });

  it('never builds an operator image', async () => {
    const d = deps({
      exec: async (file, args) => {
        calls.push([file, args]);
        if (args[0] === 'image') throw new Error('No such image');
        return { stdout: '' };
      },
    });
    await expect(
      dockerRuntime({ image: 'mine:1' }, d).wrap(launch()),
    ).rejects.toThrow(/mine:1/);
    expect(calls.some(([, a]) => a[0] === 'build')).toBe(false);
  });
});

describe('runtime-docker cleanup', () => {
  it('removes only this run container and its home', async () => {
    const home = join(cache, 'bakers/runtime/r-uuid');
    mkdirSync(home, { recursive: true });
    const d = deps({
      exec: async (file, args) => {
        calls.push([file, args]);
        return { stdout: args[0] === 'ps' ? 'abc\ndef\n' : '' };
      },
    });
    await dockerRuntime({}, d).cleanup({ uuid: 'r-uuid', id: 7 });
    expect(calls).toEqual([
      [
        'docker',
        [
          'ps',
          '-aq',
          '--filter',
          'name=^bb-run-r-uuid$',
          '--filter',
          'label=build.bakers.run=r-uuid',
        ],
      ],
      ['docker', ['rm', '-f', 'abc', 'def']],
    ]);
    expect(existsSync(home)).toBe(false);
  });

  it('skips rm when no container is left', async () => {
    await dockerRuntime({}, deps()).cleanup({ uuid: 'r-uuid', id: 7 });
    expect(calls.map(([, a]) => a[0])).toEqual(['ps']);
  });

  it('tolerates a missing docker', async () => {
    const d = deps({
      exec: async () => {
        throw new Error('spawn docker ENOENT');
      },
    });
    await expect(
      dockerRuntime({}, d).cleanup({ uuid: 'r-uuid', id: 7 }),
    ).resolves.toBeUndefined();
    expect(warnings).toContain('runtime container cleanup failed');
  });
});
