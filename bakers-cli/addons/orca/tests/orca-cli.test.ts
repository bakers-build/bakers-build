import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertOrcaReachable,
  createOrcaExec,
  OrcaError,
  parseEnvelope,
} from '../src/orca-cli.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A stand-in `orca` binary that prints `stdout` and exits with `code`. */
function fakeBinary(stdout: string, code: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-bin-'));
  dirs.push(dir);
  const bin = join(dir, 'orca');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' '${stdout}'\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe('createOrcaExec', () => {
  it('reads a failure envelope printed on stdout with exit 1', async () => {
    const orca = createOrcaExec(
      fakeBinary(
        '{"ok":false,"error":{"code":"runtime_unavailable","message":"not running"}}',
        1,
      ),
    );
    await expect(orca(['worktree', 'show'])).rejects.toThrow(
      expect.objectContaining({ code: 'runtime_unavailable' }),
    );
  });

  it('returns the result of a successful call', async () => {
    const orca = createOrcaExec(fakeBinary('{"ok":true,"result":{"x":2}}', 0));
    await expect(orca(['status'])).resolves.toEqual({ x: 2 });
  });

  it('reports a missing binary as orca CLI not found in PATH', async () => {
    const orca = createOrcaExec('/nonexistent/orca');
    await expect(orca(['status'])).rejects.toThrow(
      expect.objectContaining({
        code: 'orca_not_found',
        message: 'orca CLI not found in PATH',
      }),
    );
  });
});

describe('parseEnvelope', () => {
  it('returns the result of a success envelope', () => {
    expect(parseEnvelope('{"ok":true,"result":{"a":1}}')).toEqual({ a: 1 });
  });

  it('throws an OrcaError carrying the error code of a failure envelope', () => {
    const err = (() => {
      try {
        parseEnvelope(
          '{"ok":false,"error":{"code":"selector_not_found","message":"no such worktree"}}',
        );
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(OrcaError);
    expect((err as OrcaError).code).toBe('selector_not_found');
    expect((err as OrcaError).message).toContain('no such worktree');
  });

  it('rejects output that is not JSON as invalid_output', () => {
    expect(() => parseEnvelope('Orca is starting…')).toThrow(
      expect.objectContaining({ code: 'invalid_output' }),
    );
  });
});

describe('assertOrcaReachable', () => {
  it('names the runtime state when Orca is not reachable', async () => {
    const orca = async () => ({
      runtime: { reachable: false, state: 'not_running' },
    });
    await expect(assertOrcaReachable(orca)).rejects.toThrow(
      /Orca runtime not reachable \(state: not_running\)/,
    );
  });

  it('resolves when the runtime is reachable', async () => {
    const calls: string[][] = [];
    const orca = async (args: string[]) => {
      calls.push(args);
      return { runtime: { reachable: true, state: 'ready' } };
    };
    await expect(assertOrcaReachable(orca)).resolves.toBeUndefined();
    expect(calls).toEqual([['status']]);
  });
});
