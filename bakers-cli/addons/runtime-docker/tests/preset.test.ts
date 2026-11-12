import { describe, expect, it } from 'vitest';
import { runtimes, scopes } from '../src/preset.js';

describe('runtime-docker preset', () => {
  it('contributes one isolating runtime, machine scope only', async () => {
    const list = await runtimes?.([], { docker: 'podman' });
    expect(list).toHaveLength(1);
    expect(list?.[0]).toMatchObject({
      kind: 'runtime',
      id: 'docker',
      isolates: true,
    });
    expect(scopes).toEqual(['machine']);
  });

  it('resolves the CLI build and the shipped image directory', async () => {
    const { pluginPaths } = await import('../src/index.js');
    const { cliRoot, packageDir } = pluginPaths();
    expect(packageDir.endsWith('addons/runtime-docker')).toBe(true);
    expect(packageDir.startsWith(cliRoot)).toBe(true);
    expect(cliRoot.length).toBeGreaterThan(1);
  });
});

describe('cliRootOf', () => {
  it('is the common ancestor, widened to the outermost node_modules', async () => {
    const { cliRootOf } = await import('../src/index.js');
    expect(
      cliRootOf('/opt/cli/addons/rd', '/opt/cli/conductor', '/home/op'),
    ).toBe('/opt/cli');
    expect(
      cliRootOf(
        '/g/lib/node_modules/a/node_modules/rd',
        '/g/lib/node_modules/c',
        '/home/op',
      ),
    ).toBe('/g/lib/node_modules');
  });

  it('refuses a root that would expose the operator home', async () => {
    const { cliRootOf } = await import('../src/index.js');
    for (const [a, b] of [
      ['/opt/cli/rd', '/srv/conductor'],
      ['/home/op/dev/rd', '/home/op/.npm/conductor'],
      ['/home/op/dev/rd', '/home/other/conductor'],
    ])
      expect(() => cliRootOf(a as string, b as string, '/home/op')).toThrow(
        /would mount/,
      );
  });
});

describe('imageVersion', () => {
  it('changes when a shipped image file changes', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { imageVersion } = await import('../src/index.js');
    const dir = mkdtempSync(join(tmpdir(), 'bb-image-'));
    mkdirSync(join(dir, 'image'));
    writeFileSync(join(dir, 'image/Dockerfile'), 'FROM x');
    writeFileSync(join(dir, 'image/proxy.mjs'), 'a');
    const first = imageVersion(dir, '1.2.3');
    expect(first).toMatch(/^1\.2\.3-[0-9a-f]{12}$/);
    writeFileSync(join(dir, 'image/proxy.mjs'), 'b');
    expect(imageVersion(dir, '1.2.3')).not.toBe(first);
  });
});

it('reports layered runtime paths at config load', async () => {
  const plugins = await runtimes!([], {
    shared_runtime: {
      default: { read_only: ['.ddev'] },
      project: { read_only: ['$inherit', 'scripts'] },
    },
    read_only: ['$inherit', 'bin'],
  });
  expect(plugins[0]?.readOnly).toEqual({
    entries: [
      { value: '.ddev', source: 'default' },
      { value: 'scripts', source: 'project' },
      { value: 'bin', source: 'runtime' },
    ],
    removed: [],
  });
});

it('rejects invalid runtime paths before dispatch', () => {
  expect(() => runtimes!([], { read_only: ['../escape'] })).toThrow(
    /invalid worktree-relative path/,
  );
});
