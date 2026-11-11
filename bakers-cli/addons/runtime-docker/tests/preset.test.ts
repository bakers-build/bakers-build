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
