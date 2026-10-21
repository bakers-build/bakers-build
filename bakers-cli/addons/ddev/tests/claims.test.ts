import { describe, expect, it } from 'vitest';
import { claimDdev } from '../src/claims.js';
import type { ClaimContext, HttpProbe, RawPort } from '../src/types.js';

function rawPort(partial: Partial<RawPort>): RawPort {
  return {
    worktree: '/work',
    listening: 'unknown',
    exposed: 'unknown',
    ...partial,
  };
}

function ctx(overrides: Partial<ClaimContext> = {}): ClaimContext {
  const noProbe: HttpProbe = async () => null;
  return {
    worktree: '/work',
    ticket: 'pynq-42',
    zone: 'preview.example',
    probe: noProbe,
    ...overrides,
  };
}

/** Run the DDEV claimer alone over `raw`, as `claimServices` would. */
function claim(raw: RawPort[], context: ClaimContext) {
  const remaining = new Set(raw.map((_, i) => i));
  return claimDdev(raw, remaining, context);
}

describe('claimDdev', () => {
  const webRow = (overrides: Partial<RawPort> = {}) =>
    rawPort({
      containerId: 'web123',
      containerPort: 443,
      routerPort: 443,
      virtualHost: 'admin.pynq.pynq-42.ddev.site',
      serviceType: 'web',
      containerState: 'running',
      exposed: true,
      listening: true,
      ...overrides,
    });

  it('names the web container web and prefers HTTPS over HTTP aliases', () => {
    // Real DDEV topology: nginx inside the web container only ever listens
    // on container port 80 — HTTPS_EXPOSE=443:80 and HTTP_EXPOSE=80:80 both
    // alias that SAME container port, Traefik terminates TLS in front of it.
    // The two rows never carry distinct container ports.
    const https = webRow({ containerPort: 80, exposeScheme: 'https' });
    const http = rawPort({
      containerId: 'web123',
      containerPort: 80,
      routerPort: 80,
      exposeScheme: 'http',
      virtualHost: 'admin.pynq.pynq-42.ddev.site',
      serviceType: 'web',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const services = claim([http, https], ctx());
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      key: 'web',
      status: 'healthy',
    });
    expect(services[0]!.rules[0]!.service).toContain('443');
  });

  it('rewrites Host to the observed VIRTUAL_HOST, generically, no CMS-specific limitation', () => {
    const services = claim([webRow()], ctx());
    const web = services[0]!;
    expect(web.rules[0]!.hostHeader).toBe('admin.pynq.pynq-42.ddev.site');
    expect(web.limitation).toBeUndefined();
  });

  it('R1: Mailpit (another router port on the same web container) does not collapse into web', () => {
    const mailpit = rawPort({
      containerId: 'web123',
      containerPort: 8025,
      routerPort: 8026,
      composeService: 'web',
      daemon: 'webextradaemons:mailpit',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const services = claim([webRow({ composeService: 'web' }), mailpit], ctx());
    const keys = services.map((s) => s.key).sort();
    expect(keys).toEqual(['mailpit', 'web']);
  });

  it('R2: a PID-less nginx socket on container port 443 joins the primary-web group instead of a separate row', () => {
    const socketOnly = rawPort({
      containerId: 'web123',
      containerPort: 443,
      composeService: 'web',
      containerState: 'running',
      exposed: false,
      listening: true,
    });
    const services = claim(
      [webRow({ composeService: 'web' }), socketOnly],
      ctx(),
    );
    expect(services).toHaveLength(1);
    expect(services[0]!.key).toBe('web');
  });

  it('names a stateless DDEV service from its service-type label', () => {
    const mailpit = rawPort({
      containerId: 'mail1',
      containerPort: 8025,
      routerPort: 8026,
      virtualHost: 'mailpit.pynq-42.ddev.site',
      serviceType: 'mailpit',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const services = claim([mailpit], ctx());
    expect(services[0]).toMatchObject({ key: 'mailpit', status: 'healthy' });
  });

  it('N7: noTLSVerify is set for an HTTPS-routed service on a non-443 router port too', () => {
    const mailpit = rawPort({
      containerId: 'mail1',
      containerPort: 8025,
      routerPort: 8026,
      virtualHost: 'mailpit.pynq-42.ddev.site',
      serviceType: 'mailpit',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const services = claim([mailpit], ctx());
    expect(services[0]!.rules[0]!.service).toMatch(/^https:\/\//);
    expect(services[0]!.rules[0]!.insecureTls).toBe(true);
  });

  it('keeps two sites on the same container port separate (duplicate-name suffixing)', () => {
    const siteA = webRow({ containerId: 'webA' });
    const siteB = webRow({
      containerId: 'webB',
      virtualHost: 'members.pynq.pynq-42.ddev.site',
    });
    const services = claim([siteA, siteB], ctx());
    expect(services).toHaveLength(2);
    expect(new Set(services.map((s) => s.key)).size).toBe(2);
  });

  it('finding 6: `local` names the router port when it is not 443', () => {
    const mailpit = rawPort({
      containerId: 'mail1',
      containerPort: 8025,
      routerPort: 8026,
      virtualHost: 'mailpit.pynq-42.ddev.site',
      serviceType: 'mailpit',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const services = claim([mailpit], ctx());
    expect(services[0]!.local).toBe('https://mailpit.pynq-42.ddev.site:8026');
  });

  it('finding 6: `local` omits the port suffix for the default 443', () => {
    const services = claim([webRow()], ctx());
    expect(services[0]!.local).toBe('https://admin.pynq.pynq-42.ddev.site');
  });

  it('finding 5: a STOPPED webextradaemon still lists, even though its container also has a port-bearing group (regression from 4541c4ef0)', () => {
    const xhgui = rawPort({
      containerId: 'web123',
      daemon: 'webextradaemons:xhgui',
      daemonStatus: 'STOPPED',
      containerState: 'running',
      exposed: 'unknown',
      listening: false,
    });
    const services = claim([webRow(), xhgui], ctx());
    const keys = services.map((s) => s.key).sort();
    expect(keys).toEqual(['web', 'xhgui']);
    const stopped = services.find((s) => s.key === 'xhgui')!;
    expect(stopped.status).toBe('stopped');
  });

  it('finding 5: a RUNNING daemon twin with no containerPort still gets suppressed (nginx-style diagnostic twin)', () => {
    const nginxTwin = rawPort({
      containerId: 'web123',
      daemon: 'nginx',
      daemonStatus: 'RUNNING',
      containerState: 'running',
      exposed: 'unknown',
      listening: false,
    });
    const services = claim([webRow(), nginxTwin], ctx());
    expect(services.map((s) => s.key)).toEqual(['web']);
  });

  it('N2: a STOPPED port-less daemon still lists next to a RUNNING port-less sibling on the same container (pass-9 regression)', () => {
    // nginx/php-fpm's own port-less diagnostic twin (RUNNING, carrying the
    // `nginx` daemon name) used to share one `:unknown` group with EVERY
    // port-less row on the container, including a genuinely STOPPED
    // webextradaemon (xhgui) — whichever row the group's "best" pick
    // preferred then swallowed the other. Both must now surface as their own
    // rows.
    const nginxTwin = rawPort({
      containerId: 'web123',
      daemon: 'nginx',
      daemonStatus: 'RUNNING',
      containerState: 'running',
      exposed: 'unknown',
      listening: false,
    });
    const xhgui = rawPort({
      containerId: 'web123',
      daemon: 'webextradaemons:xhgui',
      daemonStatus: 'STOPPED',
      containerState: 'running',
      exposed: 'unknown',
      listening: false,
    });
    const services = claim([webRow(), nginxTwin, xhgui], ctx());
    const keys = services.map((s) => s.key).sort();
    expect(keys).toEqual(['web', 'xhgui']);
    const stopped = services.find((s) => s.key === 'xhgui')!;
    expect(stopped.status).toBe('stopped');
  });

  it('reports a stopped container without rules', () => {
    const xhgui = rawPort({
      containerId: 'web123',
      daemon: 'webextradaemons:xhgui',
      daemonStatus: 'STOPPED',
      containerState: 'running',
      exposed: 'unknown',
      listening: false,
    });
    const services = claim([xhgui], ctx());
    expect(services[0]).toMatchObject({ key: 'xhgui', status: 'stopped' });
    expect(services[0]!.rules).toEqual([]);
  });

  it('finding 1 (AC4): rejects a dead configured port and names the ACTUAL real-topology listener (pynq-43: vite dead on 5173, pynq-members-dev alive on 3002) — never Docker DNS', () => {
    const dead = rawPort({
      containerId: 'web123',
      containerPort: 5173,
      routerPort: 5173,
      virtualHost: 'vite.pynq-42.ddev.site',
      containerState: 'running',
      exposed: true,
      listening: false,
    });
    // Docker's embedded DNS resolver stub — listening inside the SAME
    // container's netns, never an operator-addressable service. Filtered
    // upstream by `@bakers-build/addon-docker-compose`, but a dead row's
    // candidate search must stay safe even if one slips through.
    const dockerDns = rawPort({
      containerId: 'web123',
      containerPort: 42587,
      containerState: 'running',
      exposed: false,
      listening: true,
      address: '127.0.0.11',
    });
    // The REAL daemon (`web_extra_daemons`, `.ddev/config.yaml`), named by
    // `supervisorctl status` as `webextradaemons:pynq-members-dev` — a
    // distinct name and port from the dead `vite` router alias, exactly as
    // captured live on pynq-43 (`pnpm run dev`, Nuxt on 3002).
    const realListener = rawPort({
      containerId: 'web123',
      containerPort: 3002,
      daemon: 'webextradaemons:pynq-members-dev',
      daemonStatus: 'RUNNING',
      containerState: 'running',
      exposed: false,
      listening: true,
    });
    const services = claim([dead, dockerDns, realListener], ctx());
    const vite = services.find((s) => s.key === 'vite')!;
    expect(vite.status).toBe('dead');
    expect(vite.rules).toEqual([]);
    expect(vite.limitation).toContain('5173');
    expect(vite.limitation).toContain('pynq-members-dev');
    expect(vite.limitation).toContain('3002');
    expect(vite.limitation).not.toContain('42587');
  });

  it('A: never names an already-exposed, healthy sibling (mailpit) as the dead-port diagnostic, even when `ss` lists it first (order b)', () => {
    const dead = rawPort({
      containerId: 'web123',
      containerPort: 5173,
      routerPort: 5173,
      virtualHost: 'vite.pynq-42.ddev.site',
      containerState: 'running',
      exposed: true,
      listening: false,
    });
    // `ss` row order b: mailpit's OWN exposed, healthy listener (1025 is its
    // internal port, routed through 8026) is reported before the real
    // unexposed listener — it must still never be named as "actually
    // listening instead", since it already has its own working route.
    const mailpitOwnSocket = rawPort({
      containerId: 'web123',
      containerPort: 1025,
      routerPort: 8026,
      daemon: 'webextradaemons:mailpit',
      daemonStatus: 'RUNNING',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const realListener = rawPort({
      containerId: 'web123',
      containerPort: 3002,
      daemon: 'webextradaemons:pynq-members-dev',
      daemonStatus: 'RUNNING',
      containerState: 'running',
      exposed: false,
      listening: true,
    });
    const services = claim([dead, mailpitOwnSocket, realListener], ctx());
    const vite = services.find((s) => s.key === 'vite')!;
    expect(vite.limitation).toContain('pynq-members-dev');
    expect(vite.limitation).toContain('3002');
    expect(vite.limitation).not.toContain('mailpit');
    expect(vite.limitation).not.toContain('1025');
  });

  it('B: names a dead web_extra_exposed_ports service from .ddev/config.yaml, not the shared web compose label (live pynq-43 topology)', () => {
    // Captured live from pynq-43's .ddev/config.yaml:
    //   web_extra_exposed_ports:
    //     - name: vite
    //       container_port: 5173
    //       http_port: 5172
    //       https_port: 5173
    // The dead row here carries NO virtualHost/daemon (ddev auto-generates
    // its HTTP(S)_EXPOSE mapping with no VIRTUAL_HOST, and nothing is
    // listening to report a daemon) — only the shared container's
    // `composeService: web` label, same as the primary web router row.
    // Without the config.yaml lookup this collides with the primary `web`
    // key and gets suffixed into an opaque `web-<hash>-5173` row.
    const primary = rawPort({
      containerId: 'web123',
      containerPort: 80,
      routerPort: 443,
      virtualHost: 'cow2.ddev.site',
      composeService: 'web',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const deadVite = rawPort({
      containerId: 'web123',
      containerPort: 5173,
      routerPort: 5173,
      composeService: 'web',
      containerState: 'running',
      exposed: true,
      listening: false,
    });
    const services = claim(
      [primary, deadVite],
      ctx({ webExtraExposedPortNames: new Map([[5173, 'vite']]) }),
    );
    const vite = services.find((s) => s.key === 'vite');
    expect(vite).toBeDefined();
    expect(vite!.status).toBe('dead');
    expect(vite!.limitation).toContain('5173');
    expect(services.some((s) => s.key.startsWith('web-'))).toBe(false);
  });

  it('never produces a rule for an unexposed, not-claimed listener', () => {
    const services = claim(
      [
        rawPort({
          hostAddress: '127.0.0.1',
          hostPort: 9999,
          cmdline: 'mystery-process',
        }),
      ],
      ctx(),
    );
    expect(services).toEqual([]);
  });

  // Live pynq-43 topology: the web container's internal nginx process
  // surfaces as an `unattachedDaemons` row (no `containerPort` at all) next
  // to the real, port-specific web/drupal claims on that same container —
  // it must never become its own top-level row.
  it('drops a containerPort-less daemon row (nginx) when its own container already has a real port claim', () => {
    const services = claim(
      [
        webRow({ composeService: 'web' }),
        rawPort({
          containerId: 'web123',
          daemon: 'nginx',
          daemonStatus: 'RUNNING',
          containerState: 'running',
          exposed: 'unknown',
          listening: false,
        }),
      ],
      ctx(),
    );
    expect(services.map((s) => s.key)).toEqual(['web']);
  });

  // phpmyadmin/opensearch/opensearch-dashboards each run in their own
  // container: supervisor lists the daemon (containerPort-less row) AND the
  // socket scan separately finds its real listening port — both describe the
  // SAME container, so only the port-specific row should survive.
  it('drops a containerPort-less daemon row when the SAME container also has a port-specific claim (phpmyadmin/opensearch duplicate)', () => {
    const genericRow = rawPort({
      containerId: 'pma1',
      daemon: 'phpmyadmin',
      daemonStatus: 'RUNNING',
      containerState: 'running',
      exposed: 'unknown',
      listening: false,
    });
    const portRow = rawPort({
      containerId: 'pma1',
      containerPort: 80,
      composeService: 'phpmyadmin',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const services = claim([genericRow, portRow], ctx());
    expect(services).toHaveLength(1);
    expect(services[0]!.key).toBe('phpmyadmin');
    expect(services[0]!.status).toBe('healthy');
  });

  // Live pynq-43 topology: phpmyadmin's container ALSO has a loopback-only
  // status socket (exposed:false, listening:true, containerPort 41273) with
  // no expose mapping — same `composeService` label, so the same baseName —
  // discovered BEFORE the real port-80 listener in raw-port order. The bare
  // `phpmyadmin` key must resolve to the real, healthy, tunnel-eligible row,
  // never to the not-exposed diagnostic one (`ports up phpmyadmin` must not
  // pick the row with zero rules).
  it('assigns the bare key to the healthy group even when its not-exposed sibling is discovered first', () => {
    const statusSocket = rawPort({
      containerId: 'pma1',
      containerPort: 41273,
      composeService: 'phpmyadmin',
      containerState: 'running',
      exposed: false,
      listening: true,
    });
    const realSocket = rawPort({
      containerId: 'pma1',
      containerPort: 80,
      composeService: 'phpmyadmin',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const services = claim([statusSocket, realSocket], ctx());
    expect(services).toHaveLength(2);
    const healthy = services.find((s) => s.status === 'healthy');
    const notExposed = services.find((s) => s.status === 'not-exposed');
    expect(healthy).toMatchObject({ key: 'phpmyadmin' });
    expect(healthy!.rules).toHaveLength(1);
    expect(notExposed!.key).not.toBe('phpmyadmin');
  });

  // `db` has no socket/port evidence at all — its single containerPort-less
  // row is the ONLY evidence for that container, so it must still surface
  // (AC1: unclaimed/no-port services stay visible, not suppressed).
  it('keeps a lone containerPort-less row (db, genuinely unclaimed) visible', () => {
    const dbRow = rawPort({
      containerId: 'db1',
      composeService: 'db',
      containerState: 'running',
      exposed: 'unknown',
      listening: false,
    });
    const services = claim([dbRow], ctx());
    expect(services).toHaveLength(1);
    expect(services[0]!.key).toBe('db');
    expect(services[0]!.status).toBe('unknown');
  });

  it('healthy web rule carries a direct container origin', () => {
    const services = claim(
      [
        webRow({
          containerPort: 80,
          virtualHost: 'bb-684.ddev.site',
          containerIp: '172.18.0.19',
        }),
      ],
      ctx(),
    );
    expect(services[0]!.rules[0]).toEqual({
      key: 'web',
      service: 'https://127.0.0.1:443',
      hostHeader: 'bb-684.ddev.site',
      insecureTls: true,
      direct: 'http://172.18.0.19:80',
    });
  });

  it('mailpit direct origin uses its container port, not the router port', () => {
    const mailpit = rawPort({
      containerId: 'web123',
      containerPort: 8025,
      routerPort: 8026,
      composeService: 'web',
      daemon: 'webextradaemons:mailpit',
      containerIp: '172.18.0.19',
      containerState: 'running',
      exposed: true,
      listening: true,
    });
    const services = claim([mailpit], ctx());
    expect(services[0]!.rules[0]!.direct).toBe('http://172.18.0.19:8025');
  });

  it('no container IP means no direct field', () => {
    const services = claim([webRow({ containerPort: 80 })], ctx());
    expect(services[0]!.rules[0]).not.toHaveProperty('direct');
  });

  describe('BB-681 Task 1: per-host splitting of the primary web claim', () => {
    it('emits web-<host> for a configured AND observed alias', () => {
      const services = claim(
        [
          webRow({
            virtualHost: 'demo.ddev.site,admin.ddev.site,shop.example.org',
          }),
        ],
        ctx({
          hosts: {
            primary: 'demo.ddev.site',
            additional: ['admin.ddev.site', 'shop.example.org'],
          },
        }),
      );
      const keys = services.map((s) => s.key).sort();
      expect(keys).toEqual([
        'web',
        'web-admin-ddev-site',
        'web-shop-example-org',
      ]);
      const admin = services.find((s) => s.key === 'web-admin-ddev-site')!;
      expect(admin.rules[0]).toMatchObject({
        hostHeader: 'admin.ddev.site',
      });
    });

    it('web-<host> alias rules keep the host-rewrite path without direct', () => {
      const services = claim(
        [
          webRow({
            containerPort: 80,
            virtualHost: 'demo.ddev.site,admin.ddev.site',
            containerIp: '172.18.0.19',
          }),
        ],
        ctx({
          hosts: { primary: 'demo.ddev.site', additional: ['admin.ddev.site'] },
        }),
      );
      const admin = services.find((s) => s.key === 'web-admin-ddev-site')!;
      expect(admin.rules[0]).toEqual({
        key: 'web-admin-ddev-site',
        service: 'https://127.0.0.1:443',
        hostHeader: 'admin.ddev.site',
        insecureTls: true,
      });
    });

    it('does not emit a claim for a configured-but-unobserved alias', () => {
      const services = claim(
        [webRow({ virtualHost: 'demo.ddev.site' })],
        ctx({
          hosts: {
            primary: 'demo.ddev.site',
            additional: ['admin.ddev.site'],
          },
        }),
      );
      expect(services.map((s) => s.key)).toEqual(['web']);
    });

    // BB-681 review M4: `admin-ddev.site` and `admin.ddev-site` are two
    // DIFFERENT hosts that both normalize (dots -> hyphens) to the same
    // `web-admin-ddev-site` key. Spec: reject the collision instead of
    // silently picking one by list order.
    it('rejects two aliases that collide on the same normalized key, sharing neither', () => {
      const services = claim(
        [
          webRow({
            virtualHost: 'demo.ddev.site,admin-ddev.site,admin.ddev-site',
          }),
        ],
        ctx({
          hosts: {
            primary: 'demo.ddev.site',
            additional: ['admin-ddev.site', 'admin.ddev-site'],
          },
        }),
      );
      const colliding = services.filter((s) => s.key === 'web-admin-ddev-site');
      expect(colliding).toHaveLength(2);
      for (const service of colliding) {
        expect(service.rules).toHaveLength(0);
        expect(service.limitation).toMatch(/collides/);
      }
    });

    it('never multiplies an ancillary service (mailpit) by site aliases', () => {
      const mailpit = rawPort({
        containerId: 'web123',
        containerPort: 8025,
        routerPort: 8026,
        composeService: 'web',
        daemon: 'webextradaemons:mailpit',
        containerState: 'running',
        exposed: true,
        listening: true,
      });
      const services = claim(
        [webRow({ composeService: 'web' }), mailpit],
        ctx({
          hosts: {
            primary: 'demo.ddev.site',
            additional: ['admin.ddev.site'],
          },
        }),
      );
      expect(services.filter((s) => s.key.startsWith('mailpit'))).toHaveLength(
        1,
      );
    });
  });
});
