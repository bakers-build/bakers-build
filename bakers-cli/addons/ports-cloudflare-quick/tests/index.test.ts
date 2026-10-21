// BB-681 review R4 (I2 remainder / R4-M1): `listOwnedProcesses`'s real
// `/proc` wiring must not adopt (or kill) a process just because its argv
// happens to carry the route's `--config <dir>/…` marker — that string is
// spoofable by any process. It must also match our own uid and an
// executable that is actually `cloudflared`.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeDeps } from '../src/index.js';

describe('listOwnedProcesses ownership filtering (real /proc)', () => {
  let dir: string;
  let child: ReturnType<typeof spawn> | undefined;

  afterEach(async () => {
    if (child?.pid) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('does not adopt a non-cloudflared process carrying the --config marker', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bakers-quick-ownership-'));
    // A real, long-lived, non-cloudflared process whose argv contains this
    // route's exact marker — the spoofing scenario R4 flags.
    child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 30000)', '--config', `${dir}/gen-1`],
      { stdio: 'ignore' },
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    const deps = createNodeDeps();
    const owned = await deps.listOwnedProcesses(dir);

    expect(owned).toEqual([]);
  });
});
