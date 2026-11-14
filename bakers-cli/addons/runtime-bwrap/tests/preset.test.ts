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

it('hands the shared clone option to the workspace only when set', async () => {
  expect(runtimes!([], { shared: true })[0]?.shared).toBe(true);
  expect(runtimes!([], { shared: false })[0]?.shared).toBe(false);
  expect(runtimes!([], {})[0]?.shared).toBeUndefined();
  const { readFileSync } = await import('node:fs');
  const schema = JSON.parse(
    readFileSync(new URL('../options.schema.json', import.meta.url), 'utf8'),
  );
  expect(Object.keys(schema.properties).sort()).toEqual([
    'readPaths',
    'shared',
  ]);
  expect(schema.properties.shared).toMatchObject({
    type: 'boolean',
    default: false,
  });
});
