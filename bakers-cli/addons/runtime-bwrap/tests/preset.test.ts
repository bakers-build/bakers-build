import { afterEach, expect, it, vi } from 'vitest';
import { runtimeBwrap } from '../src/index.js';
import { runtimes, scopes } from '../src/preset.js';

afterEach(() => vi.unstubAllEnvs());

it('contributes an isolating runtime only at machine scope', () => {
  expect(scopes).toEqual(['machine']);
  const plugins = runtimes!([], {});
  expect(plugins).toHaveLength(1);
  expect(plugins[0]).toMatchObject({
    kind: 'runtime',
    id: 'bwrap',
    isolates: true,
  });
});

it.skipIf(process.platform !== 'linux')(
  'refuses startup when bubblewrap is absent',
  async () => {
    vi.stubEnv('PATH', '/nonexistent-bwrap-test');
    await expect(runtimeBwrap().createRuntime()).rejects.toThrow(
      /install bubblewrap/,
    );
  },
);

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
