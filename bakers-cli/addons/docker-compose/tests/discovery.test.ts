import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  type DockerComposeDeps,
  discoverCompose,
  parseDockerInspect,
  parseDockerPsIds,
  parseSupervisorStatus,
} from '../src/discovery.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, 'fixtures', name), 'utf8');

const CONTAINERS = fixture('containers.txt');
const WEB_SOCKETS = fixture('web-sockets.txt');
const SUPERVISOR = fixture('supervisor.txt');

const WORKTREE = '/home/cw/wt/pynq-42';

describe('parseDockerPsIds', () => {
  it('reads one id per line, ignoring blanks', () => {
    expect(parseDockerPsIds('web1\nxhgui1\n\n')).toEqual(['web1', 'xhgui1']);
  });
});

describe('parseDockerInspect', () => {
  it('parses running state, labels and env from the fixture', () => {
    const containers = parseDockerInspect(CONTAINERS);
    expect(containers).toHaveLength(2);
    const web = containers.find((c) => c.id === 'web1');
    expect(web?.running).toBe(true);
    expect(web?.labels['com.ddev.approot']).toBe(WORKTREE);
    expect(web?.env.HTTPS_EXPOSE).toBe('443:443,8026:8025,5173:5173');
    const xhgui = containers.find((c) => c.id === 'xhgui1');
    expect(xhgui?.running).toBe(false);
  });

  it("reads each network's IPAddress, skipping empty ones", () => {
    const [withNetworks, without] = parseDockerInspect(
      JSON.stringify([
        {
          Id: 'web1',
          NetworkSettings: {
            Networks: {
              ddev_default: { IPAddress: '172.18.0.19' },
              other: { IPAddress: '' },
            },
          },
        },
        { Id: 'db1' },
      ]),
    );
    expect(withNetworks?.networks).toEqual(
      new Map([['ddev_default', '172.18.0.19']]),
    );
    expect(without?.networks).toEqual(new Map());
  });

  it('returns [] for malformed JSON rather than throwing', () => {
    expect(parseDockerInspect('not json')).toEqual([]);
  });
});

describe('parseSupervisorStatus', () => {
  it('reads daemon, status and pid when present', () => {
    expect(parseSupervisorStatus(SUPERVISOR)).toEqual([
      { daemon: 'webextradaemons:mailpit', status: 'RUNNING', pid: 51 },
      { daemon: 'webextradaemons:xhgui', status: 'STOPPED' },
      { daemon: 'php-fpm', status: 'RUNNING', pid: 50 },
    ]);
  });

  it('carried-over: a plain (undecorated) mailpit process name parses the same as a group:name one', () => {
    expect(
      parseSupervisorStatus('mailpit RUNNING pid 51, uptime 0:12:03'),
    ).toEqual([{ daemon: 'mailpit', status: 'RUNNING', pid: 51 }]);
  });
});

/** Build deps whose `run` dispatches on the fixtures above. */
function fixtureDeps(opts?: {
  dockerPsOk?: boolean;
  inspectOk?: boolean;
  socketsOk?: boolean;
  supervisorOk?: boolean;
}): DockerComposeDeps {
  const o = {
    dockerPsOk: true,
    inspectOk: true,
    socketsOk: true,
    supervisorOk: true,
    ...opts,
  };
  const run = vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'docker' && args[0] === 'ps') {
      return o.dockerPsOk
        ? { stdout: 'web1\nxhgui1', ok: true }
        : { stdout: '', ok: false };
    }
    if (cmd === 'docker' && args[0] === 'inspect') {
      return o.inspectOk
        ? { stdout: CONTAINERS, ok: true }
        : { stdout: '', ok: false };
    }
    if (cmd === 'docker' && args[0] === 'exec' && args.includes('ss')) {
      return o.socketsOk
        ? { stdout: WEB_SOCKETS, ok: true }
        : { stdout: '', ok: false };
    }
    if (
      cmd === 'docker' &&
      args[0] === 'exec' &&
      args.includes('supervisorctl')
    ) {
      return o.supervisorOk
        ? { stdout: SUPERVISOR, ok: true }
        : { stdout: '', ok: false };
    }
    return { stdout: '', ok: false };
  });
  return { run };
}

describe('discoverCompose', () => {
  it('reports the web container running, with its labels/env/bound ports', async () => {
    const { containers } = await discoverCompose(WORKTREE, fixtureDeps());
    const web = containers.find((c) => c.id === 'web1');
    expect(web?.running).toBe(true);
    expect(web?.env.HTTPS_EXPOSE).toBe('443:443,8026:8025,5173:5173');
    expect(web?.boundPorts.get(443)).toBe(33217);
  });

  it('attaches supervisor daemon name/status to the matching live socket by pid', async () => {
    const { containers } = await discoverCompose(WORKTREE, fixtureDeps());
    const web = containers.find((c) => c.id === 'web1')!;
    const mailpit = web.sockets.find((s) => s.containerPort === 8025);
    expect(mailpit?.daemon).toBe('webextradaemons:mailpit');
    expect(mailpit?.daemonStatus).toBe('RUNNING');
  });

  it('surfaces a STOPPED daemon with no live socket as unattached', async () => {
    const { containers } = await discoverCompose(WORKTREE, fixtureDeps());
    const web = containers.find((c) => c.id === 'web1')!;
    const xhgui = web.unattachedDaemons.find(
      (d) => d.daemon === 'webextradaemons:xhgui',
    );
    expect(xhgui?.status).toBe('STOPPED');
  });

  it('does not probe inside a stopped container', async () => {
    const deps = fixtureDeps();
    await discoverCompose(WORKTREE, deps);
    const execCalls = (deps.run as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) =>
        c[0] === 'docker' && c[1][0] === 'exec' && c[1][1] === 'xhgui1',
    );
    expect(execCalls).toHaveLength(0);
  });

  it('reports unknown evidence, never empty, when docker ps is denied (review focus 1)', async () => {
    const deps = fixtureDeps({ dockerPsOk: false, inspectOk: false });
    const { containers, diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'docker' }),
    );
    expect(containers).toHaveLength(0);
  });

  it('keeps successful socket output even when the supervisor probe fails', async () => {
    const deps = fixtureDeps({ supervisorOk: false });
    const { containers, diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'supervisor' }),
    );
    const web = containers.find((c) => c.id === 'web1')!;
    expect(web.sockets.some((s) => s.containerPort === 443)).toBe(true);
  });

  it('finding 4: exit 127 (supervisorctl not installed) is not a diagnostic — phpMyAdmin/OpenSearch/db ship no supervisor at all', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        args[0] === 'exec' &&
        args.includes('supervisorctl')
      ) {
        return { stdout: '', ok: false, exitCode: 127 };
      }
      return originalRun(cmd, args);
    });
    const { diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ source: 'supervisor' }),
    );
  });

  it('B: exit 3 (LSB NOT_RUNNING, any program STOPPED/EXITED) still parses stdout and attaches daemon names, no diagnostic', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        args[0] === 'exec' &&
        args.includes('supervisorctl')
      ) {
        return { stdout: SUPERVISOR, ok: false, exitCode: 3 };
      }
      return originalRun(cmd, args);
    });
    const { containers, diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ source: 'supervisor' }),
    );
    const web = containers.find((c) => c.id === 'web1')!;
    const mailpit = web.sockets.find((s) => s.containerPort === 8025);
    expect(mailpit?.daemon).toBe('webextradaemons:mailpit');
    expect(
      web.unattachedDaemons.some(
        (d) => d.daemon === 'webextradaemons:xhgui' && d.status === 'STOPPED',
      ),
    ).toBe(true);
  });

  it('a real execution failure (not exit 127) still surfaces a supervisor diagnostic', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        args[0] === 'exec' &&
        args.includes('supervisorctl')
      ) {
        return { stdout: '', ok: false, exitCode: 1 };
      }
      return originalRun(cmd, args);
    });
    const { diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'supervisor' }),
    );
  });

  it("finding 1: Docker's embedded DNS resolver (127.0.0.11) never surfaces as a socket", async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    const withDns = `${WEB_SOCKETS}\nLISTEN 0      511    127.0.0.11:42587       0.0.0.0:*          users:(("dnsmasq",pid=99,fd=6))\n`;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('ss')) {
        return { stdout: withDns, ok: true };
      }
      return originalRun(cmd, args);
    });
    const { containers } = await discoverCompose(WORKTREE, deps);
    const web = containers.find((c) => c.id === 'web1')!;
    expect(web.sockets.some((s) => s.containerPort === 42587)).toBe(false);
  });

  it('R6: a daemon pid owning two ports gets attached to both, independent of ss row order', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    // Same pid (51) listening on two ports — order reversed from the usual
    // fixture to prove port attachment does not depend on which line `ss`
    // printed first.
    const twoPortSockets =
      'LISTEN 0      511    127.0.0.1:1025      0.0.0.0:*          users:(("mailpit",pid=51,fd=7))\n' +
      'LISTEN 0      511    127.0.0.1:8025      0.0.0.0:*          users:(("mailpit",pid=51,fd=6))\n';
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('ss')) {
        return { stdout: twoPortSockets, ok: true };
      }
      return originalRun(cmd, args);
    });
    const { containers } = await discoverCompose(WORKTREE, deps);
    const web = containers.find((c) => c.id === 'web1')!;
    const port8025 = web.sockets.find((s) => s.containerPort === 8025);
    const port1025 = web.sockets.find((s) => s.containerPort === 1025);
    expect(port8025?.daemon).toBe('webextradaemons:mailpit');
    expect(port1025?.daemon).toBe('webextradaemons:mailpit');
  });

  it('reports a web-sockets diagnostic when the in-container probe itself fails, sockets stay empty not false', async () => {
    const deps = fixtureDeps({ socketsOk: false });
    const { containers, diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'web-sockets' }),
    );
    const web = containers.find((c) => c.id === 'web1')!;
    expect(web.sockets).toHaveLength(0);
  });

  it('unions duplicate container ids from both label filters without double-counting', async () => {
    const deps = fixtureDeps();
    const { containers } = await discoverCompose(WORKTREE, deps, {
      extraLabelFilters: ['com.ddev.approot'],
    });
    expect(containers.filter((c) => c.id === 'web1')).toHaveLength(1);
  });

  it('R2: a PID-less socket still surfaces, so a caller can attach a bound host port to it', async () => {
    // nginx's own 80/tcp listener: the in-container `ss` cannot see its
    // (root-owned) pid, but the socket line itself still proves it is
    // listening — this is exactly the real-topology row a DDEV-flavored
    // consumer needs to find a BB-500 passthrough target for (ref:BB-676
    // pass 4, R2).
    const socketsWithUnmappedPort = `${WEB_SOCKETS}\nLISTEN 0      511    127.0.0.1:80        0.0.0.0:*          users:(("nginx",pid=53,fd=6))\n`;
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('ss')) {
        return { stdout: socketsWithUnmappedPort, ok: true };
      }
      return originalRun(cmd, args);
    });
    const { containers } = await discoverCompose(WORKTREE, deps);
    const web = containers.find((c) => c.id === 'web1')!;
    const port80 = web.sockets.find((s) => s.containerPort === 80);
    expect(port80).toBeDefined();
    expect(web.boundPorts.get(80)).toBe(33218);
  });

  it('C: falls back to /proc/net/tcp when ss fails outright (exit 127)', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('ss')) {
        return { stdout: '', ok: false };
      }
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('cat')) {
        // phpMyAdmin-style image: no ss, but port 80 genuinely LISTENing
        // (hex 0050 = 80, state 0A = LISTEN).
        return {
          ok: true,
          stdout:
            '  sl  local_address rem_address   st\n' +
            '   0: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0 100 0 0 10 0\n',
        };
      }
      return originalRun(cmd, args);
    });
    const { containers } = await discoverCompose(WORKTREE, deps);
    const web = containers.find((c) => c.id === 'web1')!;
    expect(web.socketsProbed).toBe(true);
    expect(web.sockets.some((s) => s.containerPort === 80)).toBe(true);
  });

  it('N1: a /proc/net/tcp fallback on a container with no supervisor (exit 127) emits no web-sockets diagnostic', async () => {
    // phpMyAdmin/OpenSearch/db: no `ss`, no supervisor at all — there are no
    // daemon names to lose, so the fallback must not hold a reap record alive
    // forever (pass-9 regression N1).
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('ss')) {
        return { stdout: '', ok: false, exitCode: 127 };
      }
      if (
        cmd === 'docker' &&
        args[0] === 'exec' &&
        args.includes('supervisorctl')
      ) {
        return { stdout: '', ok: false, exitCode: 127 };
      }
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('cat')) {
        return {
          ok: true,
          stdout:
            '  sl  local_address rem_address   st\n' +
            '   0: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0 100 0 0 10 0\n',
        };
      }
      return originalRun(cmd, args);
    });
    const { diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ source: 'web-sockets' }),
    );
  });

  it('N1 (negative): a /proc/net/tcp fallback on a container WITH supervisor-managed daemons still flags the diagnostic', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('ss')) {
        return { stdout: '', ok: false, exitCode: 127 };
      }
      if (
        cmd === 'docker' &&
        args[0] === 'exec' &&
        args.includes('supervisorctl')
      ) {
        return { stdout: SUPERVISOR, ok: true };
      }
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('cat')) {
        return {
          ok: true,
          stdout:
            '  sl  local_address rem_address   st\n' +
            '   0: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0 100 0 0 10 0\n',
        };
      }
      return originalRun(cmd, args);
    });
    const { diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'web-sockets', containerId: 'web1' }),
    );
  });

  it('BB-681 carried-over: exit 126 with no permission-denied stderr is treated as a missing binary (like 127), no diagnostic', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        args[0] === 'exec' &&
        args.includes('supervisorctl')
      ) {
        return {
          stdout: '',
          ok: false,
          exitCode: 126,
          stderr: 'exec: "supervisorctl": executable file not found in $PATH',
        };
      }
      return originalRun(cmd, args);
    });
    const { diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ source: 'supervisor' }),
    );
  });

  it('BB-681 carried-over: exit 126 with a permission-denied stderr still surfaces a supervisor diagnostic', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        args[0] === 'exec' &&
        args.includes('supervisorctl')
      ) {
        return {
          stdout: '',
          ok: false,
          exitCode: 126,
          stderr: 'bash: /usr/bin/supervisorctl: Permission denied',
        };
      }
      return originalRun(cmd, args);
    });
    const { diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'supervisor' }),
    );
  });

  it('BB-681 carried-over: exit 126 with no stderr at all defaults to missing-binary, not a failure', async () => {
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (
        cmd === 'docker' &&
        args[0] === 'exec' &&
        args.includes('supervisorctl')
      ) {
        return { stdout: '', ok: false, exitCode: 126 };
      }
      return originalRun(cmd, args);
    });
    const { diagnostics } = await discoverCompose(WORKTREE, deps);
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ source: 'supervisor' }),
    );
  });
});
