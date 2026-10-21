import { describe, expect, it, vi } from 'vitest';
import { discoverHostPorts, type HostDiscoveryDeps } from '../src/discovery.js';

const WORKTREE = '/home/cw/wt/pynq-42';

// A real `ss -ltnpH` capture: a Storybook node listener, a listener whose pid
// vanishes before `/proc` can be read, a pid-less wildcard row, and an
// IPv6 one with an owner this test treats as foreign-worktree evidence.
const SS = `LISTEN 0      511    127.0.0.1:38581     0.0.0.0:*          users:(("node",pid=12345,fd=23))
LISTEN 0      128    127.0.0.1:8025      0.0.0.0:*          users:(("python3",pid=12399,fd=7))
LISTEN 0      4096   [::]:9999           [::]:*             users:(("some-daemon",pid=12400,fd=9))
LISTEN 0      4096   *:33000             *:*`;

function fixtureDeps(): HostDiscoveryDeps {
  const run = vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'ss' && args[0] === '-ltnpH') return { stdout: SS, ok: true };
    return { stdout: '', ok: false };
  });
  const processInfo = vi.fn(async (pid: number) =>
    pid === 12345
      ? { path: `${WORKTREE}/web`, deleted: false, cmdline: 'node storybook' }
      : pid === 12399
        ? { path: WORKTREE, deleted: false, cmdline: 'python3 -m http.server' }
        : null,
  );
  return { run, processInfo };
}

describe('discoverHostPorts', () => {
  it('reads host listeners with one processInfo call per distinct pid', async () => {
    const deps = fixtureDeps();
    const { ports } = await discoverHostPorts(WORKTREE, deps);
    expect(deps.processInfo).toHaveBeenCalledTimes(3);
    const sb = ports.find((p) => p.hostPort === 38581);
    expect(sb?.listening).toBe(true);
    expect(sb?.cwd).toBe(`${WORKTREE}/web`);
    // The pid-less wildcard row (`*:33000`, no process column) and the row
    // whose pid vanished before its cwd could be read (12400) are evidence
    // gaps, not this worktree's listeners (C3): neither is attributed here.
    expect(ports.filter((p) => p.hostPort !== undefined)).toHaveLength(2);
  });

  it('C3: excludes a listener whose owning process lives in a different worktree', async () => {
    const deps = fixtureDeps();
    deps.processInfo = vi.fn(async (pid: number) =>
      pid === 12345
        ? {
            path: '/home/cw/wt/some-other-ticket',
            deleted: false,
            cmdline: 'node storybook',
          }
        : pid === 12399
          ? {
              path: WORKTREE,
              deleted: false,
              cmdline: 'python3 -m http.server',
            }
          : null,
    );
    const { ports } = await discoverHostPorts(WORKTREE, deps);
    expect(ports.find((p) => p.hostPort === 38581)).toBeUndefined();
    expect(ports.find((p) => p.hostPort === 8025)).toBeDefined();
  });

  it('excludes cloudflared, the transport, from the services it discovers', async () => {
    const deps = fixtureDeps();
    deps.processInfo = vi.fn(async (pid: number) =>
      pid === 12345
        ? { path: WORKTREE, deleted: false, cmdline: 'cloudflared tunnel run' }
        : pid === 12399
          ? {
              path: WORKTREE,
              deleted: false,
              cmdline: 'python3 -m http.server',
            }
          : null,
    );
    const { ports } = await discoverHostPorts(WORKTREE, deps);
    expect(ports.find((p) => p.hostPort === 38581)).toBeUndefined();
  });

  it('reports a host diagnostic, never a silently empty result, when ss itself fails', async () => {
    const deps = fixtureDeps();
    deps.run = vi.fn(async () => ({ stdout: '', ok: false }));
    const { ports, diagnostics } = await discoverHostPorts(WORKTREE, deps);
    expect(ports).toHaveLength(0);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'host' }),
    );
  });
});

describe('discoverHostPorts on a non-Linux platform', () => {
  it('reports an honest platform-limitation diagnostic instead of a bare probe-failed message', async () => {
    const deps: HostDiscoveryDeps = {
      run: async () => ({ stdout: '', ok: false }), // ss missing, as on macOS
      processInfo: async () => null,
    };
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const { ports, diagnostics } = await discoverHostPorts(WORKTREE, deps);
      expect(ports).toEqual([]);
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          source: 'host',
          message: expect.stringMatching(/requires Linux/),
        }),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
