import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isPluggableTransportManaged,
  nodeDiscoveryDeps,
  parseProcStatStartTime,
} from '../src/deps-node.js';

describe('parseProcStatStartTime (AC6)', () => {
  it('reads the 22nd field as the start time', () => {
    // A real /proc/<pid>/stat line (fields truncated after what's needed);
    // starttime here is 123456.
    const stat =
      '1234 (cloudflared) S 1 1234 1234 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 123456 ' +
      '0 0 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 2 0 0 0 0 0';
    expect(parseProcStatStartTime(stat)).toBe(123456);
  });

  it('handles a comm field containing spaces and parens', () => {
    const stat =
      '1234 (my (weird) cmd) S 1 1234 1234 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 999 ' +
      '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 17 2 0 0 0 0 0';
    expect(parseProcStatStartTime(stat)).toBe(999);
  });

  it('returns null for unparseable input', () => {
    expect(parseProcStatStartTime('garbage')).toBeNull();
  });
});

describe('isPluggableTransportManaged (BB-681 Task 4)', () => {
  it('recognizes an addon-ports-cloudflare-quick managed process (private route-dir --config marker)', () => {
    const cmdline =
      'cloudflared --config /home/op/.bakers/ports/quick/abc123/gen-1/config.yaml --no-autoupdate tunnel --url http://127.0.0.1:6006 --no-tls-verify=false';
    expect(isPluggableTransportManaged(cmdline)).toBe(true);
  });

  it('recognizes a Named Cloudflare connector (`tunnel run`)', () => {
    expect(
      isPluggableTransportManaged('cloudflared tunnel run my-tunnel'),
    ).toBe(true);
  });

  it('does not flag an unrelated legacy quick-tunnel invocation (reap must still be able to kill those)', () => {
    expect(
      isPluggableTransportManaged(
        'cloudflared tunnel --url http://127.0.0.1:9999',
      ),
    ).toBe(false);
  });
});

// BB-681 review I3: the production `run` seam must hand back `stderr` on a
// non-zero exit — without it, `isPermissionDenied126` can never fire against
// a REAL `docker exec`, so every exit 126 reads as a missing binary even when
// the real cause was "permission denied".
describe('nodeDiscoveryDeps.run (BB-681 review I3)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bakers-ports-run-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('propagates real stderr on a non-zero exit, not just stdout/exitCode', async () => {
    const script = join(dir, 'fails.sh');
    await writeFile(
      script,
      '#!/bin/sh\necho "to stdout"\necho "permission denied" 1>&2\nexit 126\n',
    );
    await chmod(script, 0o755);
    const result = await nodeDiscoveryDeps.run(script, []);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(126);
    expect(result.stdout).toContain('to stdout');
    expect(result.stderr).toMatch(/permission denied/i);
  });
});
