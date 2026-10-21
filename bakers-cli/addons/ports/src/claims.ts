// BB-676 Task 2 (spec v2 split) — claim raw observations into named,
// tunnel-ready services. A claimer consumes raw IDENTITIES (array indices
// into one `RawDiscovery` pass), never a global port number: two containers
// or two site rules can share a port, so "port already seen" would silently
// merge them. Claimers run in precedence order (configured processes, DDEV,
// then the opt-in all-Node rule — specific before broad); each receives only
// what the previous claimer left in `remaining`.
//
// This package owns naming/reconciliation and the process claimers (host
// processes matched by the ports addon's `services` settings, no Docker
// call). Which processes are tunnelled is configuration, not code here; an
// unmatched listener stays unclaimed — still no numeric-port fallback. DDEV's own discovery/claim logic — everything
// that fires `docker` or interprets `HTTP(S)_EXPOSE`/`VIRTUAL_HOST`, and the
// neutral `{key, service, hostHeader?, insecureTls?}` rules it emits (BB-681:
// no CMS-specific addon or policy layer over its output any more) — lives in
// `@bakers-build/addon-ddev` (operator decision 2026-10-15: ports must not fire
// Docker calls itself). `claimServices` below runs the process rules, then
// DDEV, then all-Node, over one merged raw-discovery pass.

import type {
  ClaimContext,
  ClaimedDiscovery,
  ClaimedService,
  HttpProbe,
  RawDiscovery,
  RawPort,
} from '@bakers-build/addon-ddev';
import {
  claimDdev,
  discoverDdevHosts,
  discoverDdevPorts,
  parseWebExtraExposedPorts,
} from '@bakers-build/addon-ddev';
import { discoverHostPorts, type HostDiscoveryDeps } from './discovery.js';
import {
  DEFAULT_STORYBOOK,
  LABEL_RE,
  type ServiceRules,
} from './service-config.js';

export type {
  ClaimContext,
  ClaimedDiscovery,
  ClaimedService,
  ClaimStatus,
  HttpProbe,
  TunnelRule,
} from '@bakers-build/addon-ddev';

const TICKET_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+$/;

/**
 * `https://<lowercase-ticket>-<key>.<zone>` — pure, no I/O (spec: naming stays
 * a pure exported function). Throws on an invalid ticket, key, zone or a
 * combined label over 63 bytes; never truncates.
 */
export function publicHostname(
  ticket: string,
  key: string,
  zone: string,
): string {
  if (!zone || /[:/*]/.test(zone) || zone.includes('://')) {
    throw new Error(`invalid zone (must be a bare hostname): ${zone}`);
  }
  const t = ticket.toLowerCase();
  if (!TICKET_RE.test(t)) {
    throw new Error(
      `invalid ticket identifier (expected project-key-number): ${ticket}`,
    );
  }
  const k = key.toLowerCase();
  if (!LABEL_RE.test(k)) {
    throw new Error(`invalid service key (must be a DNS-safe label): ${key}`);
  }
  const label = `${t}-${k}`;
  if (Buffer.byteLength(label, 'utf8') > 63) {
    throw new Error(`combined label exceeds 63 bytes: ${label}`);
  }
  return `${label}.${zone}`;
}

/** The Node default inspector port. */
const INSPECTOR_DEFAULT_PORT = 9229;
const INSPECT_FLAG_RE = /^--inspect(-brk|-wait|-port)?(?:=(.*))?$/;
const PORT_VALUE_RE = /^(?:.*:)?(\d+)$/;

/**
 * Inspector ports a command line names: `--inspect`, `--inspect-brk`,
 * `--inspect-wait` or `--inspect-port`, as `=port`, `=host:port` or a separate
 * argument; a bare `--inspect*` means the default 9229. Pure, for tests.
 */
export function inspectorPorts(cmdline: string): number[] {
  const tokens = cmdline.split(/\s+/);
  const ports: number[] = [];
  tokens.forEach((token, i) => {
    const flag = INSPECT_FLAG_RE.exec(token);
    if (!flag) return;
    const value = flag[2] ?? tokens[i + 1] ?? '';
    const port = PORT_VALUE_RE.exec(value)?.[1];
    if (port !== undefined) ports.push(Number(port));
    else if (flag[2] === undefined && flag[1] !== '-port')
      ports.push(INSPECTOR_DEFAULT_PORT);
  });
  return ports;
}

/** Where a host listener answers HTTP: loopback for a loopback or wildcard
 *  bind, else the bound address. */
function probeOrigin(p: RawPort): string {
  const a = p.hostAddress ?? '';
  if (a.includes(':'))
    return a === '::' || a === '::1'
      ? `[::1]:${p.hostPort}`
      : `[${a}]:${p.hostPort}`;
  const loopback =
    a === '' ||
    a === '*' ||
    a === '0.0.0.0' ||
    a === 'localhost' ||
    a.startsWith('127.');
  return `${loopback ? '127.0.0.1' : a}:${p.hostPort}`;
}

/** Probe `/json/version`: `'inspector'` for a Node inspector, `null` for no
 *  HTTP answer at all, else `'http'`. */
async function probeInspector(
  p: RawPort,
  probe: HttpProbe,
): Promise<'inspector' | 'http' | null> {
  let result: Awaited<ReturnType<HttpProbe>>;
  try {
    result = await probe(`http://${probeOrigin(p)}/json/version`, {
      timeoutMs: 300,
    });
  } catch {
    return null;
  }
  if (!result) return null;
  try {
    const browser = (JSON.parse(result.body) as { Browser?: unknown }).Browser;
    if (typeof browser === 'string' && browser.startsWith('node.js/'))
      return 'inspector';
  } catch {
    // Not JSON: an ordinary HTTP server.
  }
  return 'http';
}

/** A loopback `/index.json` answering as a Storybook v5 static build. */
async function isStaticStorybook(
  p: RawPort,
  probe: HttpProbe,
): Promise<boolean> {
  let result: Awaited<ReturnType<HttpProbe>>;
  try {
    result = await probe(`http://127.0.0.1:${p.hostPort}/index.json`, {
      timeoutMs: 300,
    });
  } catch {
    return false;
  }
  if (!result || !result.ok) return false;
  try {
    const b = JSON.parse(result.body) as { v?: unknown; entries?: unknown };
    return b.v === 5 && !!b.entries && typeof b.entries === 'object';
  } catch {
    return false;
  }
}

function processClaim(key: string, claim: string, p: RawPort): ClaimedService {
  return {
    key,
    claim,
    status: 'healthy',
    local: `http://127.0.0.1:${p.hostPort}`,
    rawPorts: [p],
    rules: [
      {
        key,
        service: `http://127.0.0.1:${p.hostPort}`,
        // Dev servers (Vite, VitePress, Storybook) reject a foreign Host.
        hostHeader: `localhost:${p.hostPort}`,
      },
    ],
  };
}

/**
 * The process claimers over one pass: an inspector exclusion, then each
 * configured entry in order (a match on the command line; the entry keyed
 * `storybook` also claims a loopback static build by its `/index.json`).
 * Further matches of one entry get `<key>-<port>`. Only worktree-owned host
 * listeners are considered. Each listener a claimer would take is first
 * checked for a Node inspector (port 9229, an `--inspect*` flag of its own
 * process, or a `/json/version` probe) and stays unclaimed when it is one.
 */
async function claimProcesses(
  raw: readonly RawPort[],
  remaining: Set<number>,
  ctx: ClaimContext,
  rules: ServiceRules,
): Promise<{
  services: ClaimedService[];
  allNode: () => Promise<ClaimedService[]>;
}> {
  const hosts = [...remaining].filter(
    (i) => raw[i]!.hostPort !== undefined && raw[i]!.containerId === undefined,
  );
  // Inspectors are never claimed but stay listed as unclaimed.
  const blocked = new Set(
    hosts.filter((i) => {
      const p = raw[i]!;
      return (
        p.hostPort === INSPECTOR_DEFAULT_PORT ||
        inspectorPorts(p.cmdline ?? '').includes(p.hostPort!)
      );
    }),
  );
  const probed = new Map<number, Promise<'inspector' | 'http' | null>>();
  const answer = (i: number) => {
    let r = probed.get(i);
    if (!r) {
      r = probeInspector(raw[i]!, ctx.probe);
      probed.set(i, r);
    }
    return r;
  };
  const free = () => hosts.filter((i) => remaining.has(i) && !blocked.has(i));
  // The listeners of `matched` the probe verdict lets through, by port.
  const take = async (
    matched: number[],
    keep: (r: 'inspector' | 'http' | null) => boolean,
  ) => {
    const verdicts = await Promise.all(matched.map(answer));
    const ok = matched.filter((_, n) => keep(verdicts[n]!));
    matched.forEach((i, n) => {
      if (verdicts[n] === 'inspector') blocked.add(i);
    });
    return ok.sort((a, b) => raw[a]!.hostPort! - raw[b]!.hostPort!);
  };

  const services: ClaimedService[] = [];
  for (const rule of rules.entries) {
    const needle = rule.match.toLowerCase();
    const candidates = free();
    const matched = candidates.filter((i) =>
      raw[i]!.cmdline?.toLowerCase().includes(needle),
    );
    if (rule.key === DEFAULT_STORYBOOK.key) {
      const statics = await Promise.all(
        candidates
          .filter(
            (i) =>
              !matched.includes(i) &&
              (raw[i]!.hostAddress === '127.0.0.1' ||
                raw[i]!.hostAddress === 'localhost'),
          )
          .map(async (i) =>
            (await isStaticStorybook(raw[i]!, ctx.probe)) ? i : undefined,
          ),
      );
      for (const i of statics) if (i !== undefined) matched.push(i);
    }
    // Explicit entries claim without a probe answer, like Storybook always did.
    const ok = await take(matched, (r) => r !== 'inspector');
    ok.forEach((i, idx) => {
      remaining.delete(i);
      const p = raw[i]!;
      services.push(
        processClaim(
          idx === 0 ? rule.key : `${rule.key}-${p.hostPort}`,
          'process',
          p,
        ),
      );
    });
  }

  const allNode = async () => {
    if (!rules.allNode) return [];
    const node = free().filter((i) => {
      const exe = (raw[i]!.cmdline ?? '').split(/\s+/)[0]!.split('/').pop();
      return exe === 'node' || exe === 'nodejs';
    });
    // Fail closed: no HTTP answer at all is not claimed by the broad rule.
    const ok = await take(node, (r) => r === 'http');
    return ok.map((i) => {
      remaining.delete(i);
      const p = raw[i]!;
      return processClaim(`node-${p.hostPort}`, 'node', p);
    });
  };
  return { services, allNode };
}

/** Run claimers in precedence order over one raw discovery pass, specific
 *  before broad: configured process entries (with the default `storybook`),
 *  DDEV (generic `web`/`web-<host>` naming), then the opt-in all-Node rule.
 *  DDEV's keys never change: a process claim on a key DDEV produced becomes
 *  `<key>-<port>`. */
export async function claimServices(
  raw: RawDiscovery,
  ctx: ClaimContext,
  rules: ServiceRules,
): Promise<ClaimedDiscovery> {
  const remaining = new Set(raw.ports.map((_, i) => i));
  const processes = await claimProcesses(raw.ports, remaining, ctx, rules);
  const ddev = claimDdev(raw.ports, remaining, ctx);
  const nodes = await processes.allNode();
  const ddevKeys = new Set(ddev.map((s) => s.key));
  const renamed = [...processes.services, ...nodes].map((s) => {
    if (!ddevKeys.has(s.key)) return s;
    const key = `${s.key}-${s.rawPorts[0]!.hostPort}`;
    return { ...s, key, rules: s.rules.map((r) => ({ ...r, key })) };
  });
  const unclaimed = [...remaining]
    .sort((a, b) => a - b)
    .map((i) => raw.ports[i]!);
  return {
    services: [...renamed, ...ddev],
    diagnostics: raw.diagnostics,
    unclaimed,
  };
}

/** `.ddev/config.yaml`'s own raw-text reader — kept distinct from
 *  `HostDiscoveryDeps` since it is plain file I/O, not a command exec. */
export interface ConfigFileDeps {
  /** `null` for ENOENT; throwing is reserved for a real I/O failure. */
  readFile(path: string): Promise<string | null>;
}

/** Compose raw lookup and claims — the `list`/`up` entry point.
 *  Host-listener discovery (process-rule candidates) stays local; DDEV's own
 *  container discovery AND effective-host discovery (`ddev utility
 *  configyaml`) are delegated to `@bakers-build/addon-ddev`, never read/called
 *  directly here. */
export async function discoverClaimedServices(
  worktree: string,
  deps: HostDiscoveryDeps & ConfigFileDeps,
  opts: {
    readonly ticket: string;
    readonly zone: string;
    readonly probe: HttpProbe;
    readonly rules: ServiceRules;
  },
): Promise<ClaimedDiscovery> {
  const [host, ddev, hostsResult, ddevConfigYaml] = await Promise.all([
    discoverHostPorts(worktree, deps),
    discoverDdevPorts(worktree, deps),
    discoverDdevHosts(worktree, deps),
    deps.readFile(`${worktree.replace(/\/+$/, '')}/.ddev/config.yaml`),
  ]);
  // BB-681 review I1: a failed `ddev utility configyaml` read must leave a
  // diagnostic, not silently drop every `web-<host>` alias claim — without
  // one, `shouldKeepTunnelRecord` sees no evidence at all for a vanished
  // alias record and `reap` deletes a route that may still be perfectly
  // live, only unobserved this pass.
  const raw: RawDiscovery = {
    ports: [...host.ports, ...ddev.ports],
    diagnostics: [
      ...host.diagnostics,
      ...ddev.diagnostics,
      ...(hostsResult.ok
        ? []
        : [{ source: 'ddev-hosts' as const, message: hostsResult.reason }]),
    ],
  };
  return claimServices(
    raw,
    {
      worktree,
      ticket: opts.ticket,
      zone: opts.zone,
      probe: opts.probe,
      webExtraExposedPortNames: parseWebExtraExposedPorts(ddevConfigYaml),
      ...(hostsResult.ok ? { hosts: hostsResult.hosts } : {}),
    },
    opts.rules,
  );
}
