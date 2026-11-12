import { describe, expect, it } from 'vitest';
import { assertValidConfig } from '../src/index.js';

describe('runtime schema', () => {
  it.each([
    'project',
    'machine',
  ] as const)('accepts runtime layers in %s config', (kind) => {
    const base =
      kind === 'machine'
        ? { machine_id: 'm', label: 'M' }
        : { project: { name: 'p' }, states: ['todo'] };
    expect(() =>
      assertValidConfig(
        kind,
        {
          ...base,
          runtime: { read_only: ['$inherit', '.ddev', 'scripts/start.sh'] },
        },
        'config',
      ),
    ).not.toThrow();
    for (const read_only of [
      ['/etc'],
      ['../x'],
      ['a/../x'],
      [''],
      ['.'],
      ['a\\b'],
      ['C:/x'],
    ])
      expect(() =>
        assertValidConfig(kind, { ...base, runtime: { read_only } }, 'config'),
      ).toThrow(/runtime/);
    expect(() =>
      assertValidConfig(kind, { ...base, runtime: { typo: [] } }, 'config'),
    ).toThrow(/runtime/);
  });
});
