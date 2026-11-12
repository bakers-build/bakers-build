import { describe, expect, it } from 'vitest';
import {
  resolveRuntimeOptions,
  validateSharedRuntime,
} from '../../src/plugins/agent-args.js';

describe('shared runtime paths', () => {
  it('resolves replacement and inheritance with sources', () => {
    expect(
      resolveRuntimeOptions({
        shared_runtime: {
          default: { read_only: ['.ddev'] },
          project: { read_only: ['$inherit', 'scripts'] },
          machine: { read_only: ['scripts', 'config'] },
        },
        read_only: ['$inherit', 'bin'],
      }),
    ).toEqual({
      entries: [
        { value: 'scripts', source: 'machine' },
        { value: 'config', source: 'machine' },
        { value: 'bin', source: 'runtime' },
      ],
      removed: ['.ddev'],
    });
  });
  it.each([
    '/etc',
    '../x',
    'a/../x',
    '',
    '.',
    'a\\b',
    'C:/x',
    '$inherit/x',
  ])('rejects invalid path %s', (path) => {
    expect(() =>
      validateSharedRuntime({ read_only: [path] }, 'project'),
    ).toThrow(/invalid worktree-relative path/);
  });
  it('rejects unknown block and shared layer keys', () => {
    expect(() => validateSharedRuntime({ mode: 'yolo' }, 'project')).toThrow(
      /unknown key/,
    );
    expect(() =>
      resolveRuntimeOptions({ shared_runtime: { typo: {} } }),
    ).toThrow(/unknown key/);
  });
});
