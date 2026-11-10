import { describe, expect, it } from 'vitest';
import { retiredEnvErrors } from '../../src/cli/retired-env.js';

describe('retiredEnvErrors', () => {
  it('names each set old variable with its BAKERS_* replacement', () => {
    expect(
      retiredEnvErrors({
        BB_HOME: '/x',
        BB_CONDUCTOR_LOG: 'file',
        PATH: '/bin',
      }),
    ).toEqual([
      'BB_HOME was renamed: set BAKERS_HOME instead',
      'BB_CONDUCTOR_LOG was renamed: set BAKERS_CONDUCTOR_LOG instead',
    ]);
  });

  it('accepts the new names and unlisted BB_* variables', () => {
    expect(
      retiredEnvErrors({
        BAKERS_HOME: '/x',
        BB_E2E_FOO: '1',
        BB_UI_INPUT_TRACE: '1',
        BB_EXTRA: '1',
      }),
    ).toEqual([]);
  });

  it('rejects a set-but-empty old variable', () => {
    expect(retiredEnvErrors({ BB_CONDUCTOR_CONFIG: '' })).toEqual([
      'BB_CONDUCTOR_CONFIG was renamed: set BAKERS_CONDUCTOR_CONFIG instead',
    ]);
  });
});
