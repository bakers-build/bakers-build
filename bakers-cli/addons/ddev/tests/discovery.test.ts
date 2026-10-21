import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DockerComposeDeps } from '@bakers-build/addon-docker-compose';
import { describe, expect, it, vi } from 'vitest';
import {
  discoverDdevPorts,
  parseExposeMapping,
  parseWebExtraExposedPorts,
} from '../src/discovery.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, 'fixtures', name), 'utf8');

const CONTAINERS = fixture('containers.txt');
const WEB_SOCKETS = fixture('web-sockets.txt');
const SUPERVISOR = fixture('supervisor.txt');

const WORKTREE = '/home/cw/wt/pynq-42';

describe('parseWebExtraExposedPorts', () => {
  // Captured live from pynq-43's .ddev/config.yaml.
  const CONFIG_YAML = [
    'name: cow2',
    'type: drupal10',
    'docroot: code/chemistree-social/docroot',
    'web_extra_exposed_ports:',
    '  -',
    '    name: vite',
    '    container_port: 5173',
    '    http_port: 5172',
    '    https_port: 5173',
    'web_extra_daemons:',
    '  -',
    '    name: pynq-members-dev',
    "    command: 'pnpm run dev'",
    '',
  ].join('\n');

  it('keys the declared name by container_port', () => {
    expect(parseWebExtraExposedPorts(CONFIG_YAML)).toEqual(
      new Map([[5173, 'vite']]),
    );
  });

  it('returns an empty map for null or a config with no such key', () => {
    expect(parseWebExtraExposedPorts(null).size).toBe(0);
    expect(parseWebExtraExposedPorts('name: cow2\n').size).toBe(0);
  });

  it("finding 3: parses DDEV's documented inline form (`- name: vite` on one line, e.g. swissbit-frontend)", () => {
    const inline = [
      'web_extra_exposed_ports:',
      '  - name: vite',
      '    container_port: 5173',
      '    http_port: 5172',
      '    https_port: 5173',
      'web_extra_daemons: []',
    ].join('\n');
    expect(parseWebExtraExposedPorts(inline)).toEqual(
      new Map([[5173, 'vite']]),
    );
  });

  it('finding 3: parses multiple inline-form entries without bleeding fields between them', () => {
    const inline = [
      'web_extra_exposed_ports:',
      '  - name: vite',
      '    container_port: 5173',
      '  - name: xhgui',
      '    container_port: 8142',
      'web_extra_daemons: []',
    ].join('\n');
    expect(parseWebExtraExposedPorts(inline)).toEqual(
      new Map([
        [5173, 'vite'],
        [8142, 'xhgui'],
      ]),
    );
  });

  it('reads multiple entries and stops at the next top-level key', () => {
    const multi = [
      'web_extra_exposed_ports:',
      '  -',
      '    name: vite',
      '    container_port: 5173',
      '  -',
      '    name: xhgui',
      '    container_port: 8142',
      'web_extra_daemons: []',
    ].join('\n');
    expect(parseWebExtraExposedPorts(multi)).toEqual(
      new Map([
        [5173, 'vite'],
        [8142, 'xhgui'],
      ]),
    );
  });
});

describe('parseExposeMapping', () => {
  it('reads router:container pairs, and a bare port as both', () => {
    expect(parseExposeMapping('443:443,8026:8025')).toEqual([
      { routerPort: 443, containerPort: 443 },
      { routerPort: 8026, containerPort: 8025 },
    ]);
    expect(parseExposeMapping('80')).toEqual([
      { routerPort: 80, containerPort: 80 },
    ]);
  });

  it('drops a malformed entry rather than throwing', () => {
    expect(parseExposeMapping('abc:443,8026:8025')).toEqual([
      { routerPort: 8026, containerPort: 8025 },
    ]);
  });
});

/** Build deps whose `run` dispatches on the fixtures above. */
function fixtureDeps(opts?: {
  dockerPsOk?: boolean;
  inspectOk?: boolean;
  socketsOk?: boolean;
  supervisorOk?: boolean;
  /** C: the `/proc/net/tcp`(6) fallback used when `ss` itself fails. */
  procNetOk?: boolean;
  procNetStdout?: string;
}): DockerComposeDeps {
  const o = {
    dockerPsOk: true,
    inspectOk: true,
    socketsOk: true,
    supervisorOk: true,
    procNetOk: false,
    procNetStdout: '',
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
    if (cmd === 'docker' && args[0] === 'exec' && args.includes('cat')) {
      return o.procNetOk
        ? { stdout: o.procNetStdout, ok: true }
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

describe('discoverDdevPorts', () => {
  it('marks an exposed container port that nothing listens on as dead (AC4)', async () => {
    const { ports } = await discoverDdevPorts(WORKTREE, fixtureDeps());
    const vite = ports.find((p) => p.routerPort === 5173);
    expect(vite?.exposed).toBe(true);
    expect(vite?.listening).toBe(false);
  });

  it('marks a listening container port with no exposure rule as not exposed (AC1)', async () => {
    const { ports } = await discoverDdevPorts(WORKTREE, fixtureDeps());
    const nuxt = ports.find((p) => p.containerPort === 3002);
    expect(nuxt?.listening).toBe(true);
    expect(nuxt?.exposed).toBe(false);
  });

  it('resolves an exposed+listening container port (drupal 443) as both true', async () => {
    const { ports } = await discoverDdevPorts(WORKTREE, fixtureDeps());
    const drupal = ports.find((p) => p.routerPort === 443);
    expect(drupal?.exposed).toBe(true);
    expect(drupal?.listening).toBe(true);
    expect(drupal?.virtualHost).toContain('admin.pynq.pynq-42.ddev.site');
  });

  it('C4: names the container from the real com.docker.compose.service label, not the nonexistent service-type one', async () => {
    const { ports } = await discoverDdevPorts(WORKTREE, fixtureDeps());
    const drupal = ports.find((p) => p.routerPort === 443);
    expect(drupal?.composeService).toBe('web');
  });

  it('C4: carries the bound host port from docker inspect NetworkSettings.Ports for the BB-500 passthrough target', async () => {
    const { ports } = await discoverDdevPorts(WORKTREE, fixtureDeps());
    const drupal = ports.find((p) => p.routerPort === 443);
    expect(drupal?.hostBoundPort).toBe(33217);
  });

  it("carries the container's ddev_default IP on every row of that container", async () => {
    const { ports } = await discoverDdevPorts(WORKTREE, fixtureDeps());
    const web = ports.filter((p) => p.containerId === 'web1');
    expect(web.length).toBeGreaterThan(0);
    for (const row of web) expect(row.containerIp).toBe('172.18.0.19');
    const xhgui = ports.filter((p) => p.containerId === 'xhgui1');
    for (const row of xhgui) expect(row.containerIp).toBeUndefined();
  });

  it('attaches supervisor daemon name/status to the matching live socket by pid', async () => {
    const { ports } = await discoverDdevPorts(WORKTREE, fixtureDeps());
    const mailpit = ports.find((p) => p.containerPort === 8025);
    expect(mailpit?.daemon).toBe('webextradaemons:mailpit');
    expect(mailpit?.daemonStatus).toBe('RUNNING');
  });

  it('surfaces a STOPPED daemon as its own row, distinct from exposed-but-dead', async () => {
    const { ports } = await discoverDdevPorts(WORKTREE, fixtureDeps());
    const xhgui = ports.find((p) => p.daemon === 'webextradaemons:xhgui');
    expect(xhgui?.daemonStatus).toBe('STOPPED');
    expect(xhgui?.listening).toBe(false);
    expect(xhgui?.exposed).toBe('unknown');
  });

  it('reports unknown evidence, never false, when docker ps is denied (review focus 1)', async () => {
    const deps = fixtureDeps({ dockerPsOk: false, inspectOk: false });
    const { ports, diagnostics } = await discoverDdevPorts(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'docker' }),
    );
    expect(ports).toHaveLength(0);
  });

  it('keeps successful socket output even when the supervisor probe fails', async () => {
    const deps = fixtureDeps({ supervisorOk: false });
    const { ports, diagnostics } = await discoverDdevPorts(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'supervisor' }),
    );
    const drupal = ports.find((p) => p.routerPort === 443);
    expect(drupal?.listening).toBe(true);
  });

  it('C: falls back to /proc/net/tcp as listening evidence when ss itself fails', async () => {
    // Container port 443 genuinely LISTENing per /proc/net/tcp (hex port
    // 01BB = 443, state 0A = LISTEN) — real evidence, not a guess from a
    // published host port binding.
    const procNet =
      '  sl  local_address rem_address   st\n' +
      '   0: 00000000:01BB 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0\n';
    const deps = fixtureDeps({
      socketsOk: false,
      procNetOk: true,
      procNetStdout: procNet,
    });
    const { ports } = await discoverDdevPorts(WORKTREE, deps);
    const drupal = ports.find((p) => p.routerPort === 443);
    expect(drupal?.listening).toBe(true);
  });

  it('C: a mapped port NOT present in /proc/net/tcp stays dead, not falsely healthy from a host binding', async () => {
    // /proc/net/tcp succeeds (so the probe genuinely ran) but reports no
    // LISTEN entry at all — container port 443 has a published bound host
    // port in the fixture, which must NOT be trusted as proof of health.
    const deps = fixtureDeps({
      socketsOk: false,
      procNetOk: true,
      procNetStdout: '  sl  local_address rem_address   st\n',
    });
    const { ports } = await discoverDdevPorts(WORKTREE, deps);
    const drupal = ports.find((p) => p.routerPort === 443);
    expect(drupal?.listening).toBe(false);
  });

  it('C: both ss and /proc/net/tcp failing outright stays unknown, never dead or healthy', async () => {
    const deps = fixtureDeps({ socketsOk: false, procNetOk: false });
    const { ports, diagnostics } = await discoverDdevPorts(WORKTREE, deps);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ source: 'web-sockets' }),
    );
    const mailpit = ports.find((p) => p.routerPort === 8026);
    expect(mailpit?.listening).toBe('unknown');
  });

  it('N8: merges HTTP_EXPOSE and HTTPS_EXPOSE when both are set, instead of dropping one', async () => {
    const containerWithBoth = JSON.stringify([
      {
        Id: 'web2',
        State: { Running: true },
        Config: {
          Labels: {
            'com.ddev.approot': WORKTREE,
            'com.docker.compose.service': 'web',
          },
          Env: [
            'HTTPS_EXPOSE=443:443',
            // A second router port, HTTP-only, to a DIFFERENT container port
            // — must survive alongside the HTTPS mapping above, not replace it.
            'HTTP_EXPOSE=8080:8080',
            'VIRTUAL_HOST=pynq-42.ddev.site',
          ],
        },
        NetworkSettings: { Ports: {} },
      },
    ]);
    const deps: DockerComposeDeps = {
      run: vi.fn(async (cmd: string, args: string[]) => {
        if (cmd === 'docker' && args[0] === 'ps') {
          return { stdout: 'web2', ok: true };
        }
        if (cmd === 'docker' && args[0] === 'inspect') {
          return { stdout: containerWithBoth, ok: true };
        }
        return { stdout: '', ok: false };
      }),
    };
    const { ports } = await discoverDdevPorts(WORKTREE, deps);
    expect(
      ports.some((p) => p.routerPort === 443 && p.containerPort === 443),
    ).toBe(true);
    expect(
      ports.some((p) => p.routerPort === 8080 && p.containerPort === 8080),
    ).toBe(true);
  });

  it('unions duplicate container ids from both label filters without double-counting', async () => {
    const deps = fixtureDeps();
    const { ports } = await discoverDdevPorts(WORKTREE, deps);
    const drupalRows = ports.filter((p) => p.routerPort === 443);
    expect(drupalRows).toHaveLength(1);
  });

  it('R2: a PID-less socket with no exposure rule still carries the bound host port, when docker inspect has one', async () => {
    // nginx's own 80/tcp listener: no HTTPS_EXPOSE mapping targets container
    // port 80 directly (the fixture maps 443:443, 8026:8025, 5173:5173), but
    // `docker inspect` still publishes a host binding for it — this is
    // exactly the real-topology row the claimer needs `hostBoundPort` on to
    // find a BB-500 passthrough target.
    const socketsWithUnmappedPort = `${WEB_SOCKETS}\nLISTEN 0      511    127.0.0.1:80        0.0.0.0:*          users:(("nginx",pid=53,fd=6))\n`;
    const deps = fixtureDeps();
    const originalRun = deps.run;
    deps.run = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'docker' && args[0] === 'exec' && args.includes('ss')) {
        return { stdout: socketsWithUnmappedPort, ok: true };
      }
      return originalRun(cmd, args);
    });
    const { ports } = await discoverDdevPorts(WORKTREE, deps);
    const unmapped = ports.find(
      (p) => p.containerPort === 80 && p.exposed === false,
    );
    expect(unmapped?.hostBoundPort).toBe(33218);
  });
});
