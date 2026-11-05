import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BbCommandHost } from '@bakers-build/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `bakers deployment tickets` reads git history and resolves identifiers over
// the connection; no conductor config is required. Git and the project-config
// read stay real; only the connection (its client) and the Drupal remote are stubbed.
const seen = vi.hoisted(() => ({ projects: [] as string[] }));

vi.mock('@bakers-build/core', async (orig) => {
  const actual = await orig<typeof import('@bakers-build/core')>();
  const rows = [
    {
      name: 'bakers',
      repository: { url: 'ssh://git@git.example/bakers-build/bakers.git' },
    },
    { name: 'shop', repository: { url: 'https://git.example/keytec/shop' } },
  ];
  const query = {
    fields: () => query,
    page: () => query,
    list: async () =>
      rows.map((r) => ({
        id: r.name,
        attr: (k: string) => r[k as keyof typeof r],
      })),
  };
  return {
    ...actual,
    loadBbConfig: async () => ({
      site: { base_url: 'https://bakers.test', jsonapi_prefix: 'jsonapi' },
      plugins: [],
    }),
    createBbConnectionClient: async () => ({ collection: () => query }),
  };
});

vi.mock('@bakers-build/addon-remote-drupal', () => ({
  DrupalBbRemote: class {
    async resolveTicketByIdentifier(project: string, id: string) {
      seen.projects.push(project);
      return id === 'BAKERS-88' ? { uuid: 'u88', title: 'fix' } : null;
    }
  },
}));

const { default: plugin } = await import('../src/index.js');

let repo: string;
const cwd = process.cwd();
const env = { ...process.env };

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'deployment-'));
  process.env.BB_HOME = mkdtempSync(join(tmpdir(), 'bb-home-'));
  delete process.env.BB_CONDUCTOR_CONFIG;
  delete process.env.BB_CONDUCTOR;
  git('init', '-q');
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  );
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'BAKERS-88: fix',
  );
  process.chdir(repo);
  seen.projects = [];
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(repo, { recursive: true, force: true });
  rmSync(process.env.BB_HOME as string, { recursive: true, force: true });
  process.env = { ...env };
});

function conductorConfig(source: string): void {
  mkdirSync(join(repo, '.bakers'));
  writeFileSync(join(repo, '.bakers', 'conductor.config.js'), source);
}

async function tickets(...extra: string[]): Promise<unknown> {
  const program = new Command();
  program.exitOverride();
  plugin.register(program, {} as BbCommandHost);
  const logs: string[] = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((m?: unknown) => void logs.push(String(m)));
  try {
    await program.parseAsync(
      ['deployment', 'tickets', '--since', 'HEAD~1', '--to', 'HEAD', ...extra],
      { from: 'user' },
    );
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(logs[0] ?? 'null');
}

const BATCH = {
  range: 'HEAD~1..HEAD',
  resolved: [{ identifier: 'BAKERS-88', uuid: 'u88', title: 'fix' }],
  unresolved: [],
};

describe('bakers deployment tickets without a working conductor', () => {
  it('with no conductor config, takes the project from the origin remote', async () => {
    git('remote', 'add', 'origin', 'git@git.example:bakers-build/bakers.git');
    expect(await tickets()).toEqual(BATCH);
    expect(seen.projects).toEqual(['bakers']);
  });

  it('with no conductor config, takes the project from --project', async () => {
    expect(await tickets('--project', 'shop')).toEqual(BATCH);
    expect(seen.projects).toEqual(['shop']);
  });

  it('with no conductor config and an unknown origin, fails naming --project', async () => {
    git('remote', 'add', 'origin', 'git@git.example:someone/else.git');
    await expect(tickets()).rejects.toThrow(/--project/);
  });

  it('reads the project from a pre-UUID config that carries machine_id', async () => {
    conductorConfig(
      "export default { bakers: { project: 'bakers' }, machine_id: 'old', conductor_id: 'u-old-bakers' };\n",
    );
    expect(await tickets()).toEqual(BATCH);
    expect(seen.projects).toEqual(['bakers']);
  });

  it('reads the project from a current config on a machine with no machine_id', async () => {
    conductorConfig(
      "export default { bakers: { project: 'bakers' }, addons: ['@bakers-build/addon-claude'] };\n",
    );
    expect(await tickets()).toEqual(BATCH);
    expect(seen.projects).toEqual(['bakers']);
  });
});
