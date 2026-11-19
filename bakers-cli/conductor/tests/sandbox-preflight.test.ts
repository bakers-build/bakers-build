import { expect, it } from 'vitest';
import { runtimeSandboxWarning } from '../src/plugins/sandbox-preflight.js';

it('warns about an unchecked runtime, but not about docker, which probes its agent', () => {
  expect(runtimeSandboxWarning('host')).toBeUndefined();
  expect(runtimeSandboxWarning('docker')).toBeUndefined();
  expect(runtimeSandboxWarning('bwrap')).toMatch(
    /runtime bwrap is not checked/,
  );
});
