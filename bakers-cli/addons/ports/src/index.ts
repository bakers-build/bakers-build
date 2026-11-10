// BB-676 Task 4 — `bakers ports`: the command half, usable with no cockpit.
//
// Five subcommands over one worktree — the current `cwd`, which IS the checkout
// a conductor runs a ticket in (spec D4):
//   list    every claimed service of this worktree, named or "no addon"
//   status  this worktree's machine tunnel records — applied/pending/error
//   up      share one claimed service's key over the named tunnel, or every
//           eligible one when no key is given (spec v5)
//   down    take a key's tunnel down (or every key of this worktree)
//   reap    machine-wide reconciliation, plus legacy per-port cloudflared cleanup
//
// BB-500's generic `up <port> --url` is gone: a port is not a tunnel target,
// a CLAIM is (spec "Addon claims"). `applyUpUrl` and the old numeric `up`
// return an actionable "pick a service key" error instead of silently
// tunnelling an unclaimed listener.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { BbCommandHost, BbCommandPlugin } from '@bakers-build/core';
import { homeBbDir } from '@bakers-build/core';
import type { Command } from 'commander';
import { servicesToShare, shareAll } from './claim-share.js';
import type { ClaimedDiscovery, ClaimedService, TunnelRule } from './claims.js';
import {
  bringUpTunnel,
  discoverClaimedServices,
  loadClaimers,
  loadPortsTransport,
  type OperationContext,
  type PortsTransport,
  portsSettings,
  readMachineTunnelRecords,
  readPortsSettings,
  reapTunnels,
  takeDownTunnel,
} from './core.js';
import {
  isOwnedByCurrentUser,
  listCloudflaredProcesses,
  nodeDeps,
  nodeHttpProbe,
  nodeTunnelOpsDeps,
  processStartTime,
  readLegacyTunnelPids,
} from './deps-node.js';
import { serviceRules } from './service-config.js';
import { recordMatchesRule } from './tunnel-ops.js';
import type { TunnelDesiredRecord } from './tunnel-state.js';
import type { RawPort } from './types.js';

// Deliberately stricter than `claims.ts`'s `TICKET_RE` (which also validates
// an already-known, hyphenated project key): extracting a token out of a
// branch name needs a tight boundary so two neighbouring tickets in one
// branch (`merge-bb-1-into-bb-2`) read as two tokens, not one greedy
// match swallowing the words between them.
const TICKET_TOKEN_RE = /\b([a-z][a-z0-9]*-\d+)\b/gi;

export type TicketResolution =
  | { readonly ok: true; readonly identifier: string }
  | { readonly ok: false; readonly message: string };

/**
 * `--ticket` wins outright. Otherwise the unique token in the branch name —
 * fail on none or more than one, never guess (spec "Public names and CLI").
 */
export function resolveTicketIdentifier(
  explicit: string | undefined,
  branch: string | null,
): TicketResolution {
  if (explicit) return { ok: true, identifier: explicit };
  if (!branch) {
    return {
      ok: false,
      message: 'no --ticket given and no branch to infer it from',
    };
  }
  const matches = [
    ...new Set(
      [...branch.matchAll(TICKET_TOKEN_RE)].map((m) => m[1]!.toUpperCase()),
    ),
  ];
  if (matches.length === 0) {
    return {
      ok: false,
      message: `no ticket token found in branch '${branch}'; pass --ticket`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message: `ambiguous ticket tokens in branch '${branch}': ${matches.join(', ')}; pass --ticket`,
    };
  }
  return { ok: true, identifier: matches[0]! };
}

export type ServiceSelection =
  | { readonly ok: true; readonly service: ClaimedService }
  | { readonly ok: false; readonly message: string };

/**
 * `<service>` matches a claimed key or its unsuffixed base name (`drupal`
 * matches `drupal` and `drupal-<suffix>`). spec v5: every multisite claim
 * already carries a distinct, fully-qualifying key (`drupal-admin`,
 * `drupal-default`, …, per the R3 fix) — so a base name matching more than
 * one candidate tells the caller to use the full key instead of needing a
 * separate `--host` disambiguation path.
 */
export function selectService(
  discovery: ClaimedDiscovery,
  service: string,
): ServiceSelection {
  // B: an exact key match always wins over a prefix match — `opensearch`
  // must resolve to the `opensearch` service even though `opensearch-dashboards`
  // also starts with `opensearch-`.
  const exact = discovery.services.find((s) => s.key === service);
  const candidates = exact
    ? [exact]
    : discovery.services.filter((s) => s.key.startsWith(`${service}-`));
  if (candidates.length === 0) {
    const known = discovery.services.map((s) => s.key).join(', ') || 'none';
    return {
      ok: false,
      message: `no claimed service '${service}'. Known services: ${known}`,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      message: `ambiguous service '${service}': ${candidates.map((s) => s.key).join(', ')}; use the full key`,
    };
  }
  return { ok: true, service: candidates[0]! };
}

/** AC6: is a `cloudflared --url …` process still a legacy-reap candidate?
 *  Strong evidence (a deleted cwd — the worktree itself is gone) stands
 *  alone. Otherwise the worktree still exists, so this process might be an
 *  ordinary live service unrelated to the pre-BB-676 per-port flow — only
 *  that worktree's own OLD `.bakers/ports-tunnels.json` naming this exact pid
 *  (migration evidence, read-only, never this addon's own state) corroborates
 *  killing it anyway. */
export function isLegacyKillCandidate(
  proc: { readonly deleted: boolean; readonly pid: number },
  legacyPids: ReadonlySet<number> | null,
): boolean {
  return proc.deleted || (legacyPids?.has(proc.pid) ?? false);
}

/** AC6: the final identity check immediately before `SIGTERM` — the listing
 *  pass and this kill are not atomic, so the pid may have been reused by an
 *  unrelated process in between. Start time is the strongest of the three
 *  checks (cmdline/deleted-cwd alone can coincidentally match a reused pid
 *  running a similar-looking process); a `null` on either side (the probe
 *  itself could not read it) degrades to the older cmdline/cwd-only check
 *  rather than refusing every kill outright. */
export function revalidatesForKill(
  fresh: { readonly cmdline: string; readonly deleted: boolean } | null,
  freshStartTime: number | null,
  proc: {
    readonly cmdline: string;
    readonly deleted: boolean;
    readonly startTime: number | null;
  },
): boolean {
  if (!fresh) return false;
  if (fresh.cmdline !== proc.cmdline || fresh.deleted !== proc.deleted) {
    return false;
  }
  return freshStartTime === proc.startTime;
}

/** R4: whether `reap`, having re-discovered a worktree, should keep (not
 *  remove) one of its tunnel records — pure so the host/container evidence
 *  split (N3's fix and the regression it caused) has a direct unit test.
 *  A record with no matching claimed service is kept only when a
 *  container-backed probe failed (`docker`/`web-sockets`/`supervisor`);
 *  ordinary host diagnostics there are not about THIS record. A record WITH
 *  a matching claimed service is kept when that claim is `unknown`, or a
 *  diagnostic exists for whichever evidence source its own raw ports
 *  actually came from (host-only services, e.g. Storybook, must not be
 *  reaped on a failed host `ss`; container services must not be reaped on a
 *  failed Docker probe). */
export function shouldKeepTunnelRecord(
  discovery: ClaimedDiscovery,
  key: string,
): boolean {
  const claimed = discovery.services.find((s) => s.key === key);
  if (claimed) {
    if (claimed.status === 'unknown') return true;
    const usesHost = claimed.rawPorts.some((p) => p.containerId === undefined);
    // D: only a diagnostic about THIS record's own origin(s) can block its
    // reap — a diagnostic with a `containerId` that does not match any of
    // this claim's own container(s) is about a different, unrelated
    // container in the same worktree and must not withhold this record.
    const ownContainerIds = new Set(
      claimed.rawPorts
        .map((p) => p.containerId)
        .filter((id): id is string => id !== undefined),
    );
    const blocked = discovery.diagnostics.some((d) => {
      if (usesHost && d.source === 'host') return true;
      if (d.source === 'host') return false;
      // A whole-pass failure (no `containerId`, e.g. `docker ps`/`docker
      // inspect` itself failing) genuinely blinds every container claim.
      if (d.containerId === undefined) return ownContainerIds.size > 0;
      return ownContainerIds.has(d.containerId);
    });
    if (blocked) return true;
    return claimed.rules.length > 0;
  }
  // Finding 4/B/C: a vanished claim cannot be origin-scoped by container id
  // (a `TunnelDesiredRecord` persists only the key, not which container it
  // came from), so it cannot tell "this diagnostic is about MY container"
  // from "about some other one" the way the claimed branch above can. Any
  // non-host diagnostic therefore blocks the reap of a no-claim record — a
  // per-container probe gap (`supervisorctl` exit 3/127 in the SAME
  // container, the `/proc/net/tcp` pid-less fallback) must keep the record
  // rather than erase its name. A `source: 'host'` diagnostic only counts
  // when it is a whole-probe failure (`ss -ltnpH` itself failing) — the
  // host-side equivalent of a `containerId`-less Docker diagnostic — since
  // that blinds every host-backed no-claim record at once, same as a
  // host-backed claimed record is kept on it above. A diagnostic carrying a
  // `keyPrefix` (a claimer's, BB-681 review I1) blocks only keys under that
  // prefix — it says nothing about another claim (e.g. `storybook`) in the
  // SAME worktree, so it must not block THAT record's reap (BB-681 review N1).
  return discovery.diagnostics.some((d) => {
    if (d.source === 'host') return d.wholePass === true;
    if (d.keyPrefix !== undefined)
      return key === d.keyPrefix || key.startsWith(`${d.keyPrefix}-`);
    return true;
  });
}

export function currentBranch(worktree: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktree,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/** Resolve the ports addon entry's transport for `worktree` via the SAME shared
 *  loader the conductor tools use (`config.ts`'s `loadPortsTransport`) — one code
 *  path for both, so a missing package, invalid settings, or unsupported
 *  contract always yields the same bounded, redacted diagnostic no matter
 *  which entry point asked. Never falls back to another transport: a
 *  misconfigured/unselected transport fails closed. */
async function resolveTransport(
  worktree: string,
): Promise<
  | { readonly ok: true; readonly transport: PortsTransport }
  | { readonly ok: false; readonly message: string }
> {
  try {
    const settings = await portsSettings(worktree);
    const transport = await loadPortsTransport(settings, homeBbDir());
    return { ok: true, transport };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Claim `worktree`'s services under its own ports settings; throws for a
 *  malformed settings entry (see `readPortsSettings`). */
async function discover(
  worktree: string,
  ticket: string,
  zone: string,
): Promise<ClaimedDiscovery> {
  const settings = await readPortsSettings(worktree);
  return discoverClaimedServices(worktree, nodeDeps, {
    ticket,
    zone,
    probe: nodeHttpProbe,
    rules: serviceRules(settings),
    claimers: await loadClaimers(settings, homeBbDir()),
  });
}

/** `discover`, or print its error and set a failing exit code. */
async function discoverOrFail(
  worktree: string,
  ticket: string,
  zone: string,
): Promise<ClaimedDiscovery | undefined> {
  try {
    return await discover(worktree, ticket, zone);
  } catch (err) {
    process.stdout.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return undefined;
  }
}

function serviceLine(service: ClaimedService): string {
  const flags: string[] = [service.status];
  if (service.rules.length === 0) flags.push('no addon tunnel');
  const limitation = service.limitation ? ` — ${service.limitation}` : '';
  return `${service.key}\t${service.claim}\t${service.local}\t[${flags.join(', ')}]${limitation}`;
}

const ANSI_DIM = '\u001b[2m';
const ANSI_RESET = '\u001b[0m';

/** An unclaimed raw port's `list` row: literally "no addon" (spec), dimmed
 *  only in a TTY — plain text otherwise, so piped/CI output stays parseable. */
function unclaimedLine(port: RawPort, dim: boolean): string {
  const label = port.cwd ?? `container:${port.containerId ?? 'unknown'}`;
  const where = port.hostPort ?? port.containerPort ?? port.routerPort ?? '?';
  const line = `${label}:${where}\tno addon`;
  return dim ? `${ANSI_DIM}${line}${ANSI_RESET}` : line;
}

/** Is a recorded route still backed by a claim, and with which rule? Used
 *  by `reap` and by every `up`. A changed rule (restarted container, new
 *  IP or port) comes back so the caller can refresh the route instead of
 *  only pruning or keeping the stale one. */
export function liveTunnel(
  record: TunnelDesiredRecord,
  discovery: ClaimedDiscovery,
): { live: boolean; rule?: TunnelRule } {
  // C2/N3/R4: see `shouldKeepTunnelRecord`'s doc comment for the
  // evidence-source split this depends on.
  if (!shouldKeepTunnelRecord(discovery, record.key)) return { live: false };
  const claimed = discovery.services.find((s) => s.key === record.key);
  const rule =
    claimed?.rules.find((r) => r.key === record.key) ?? claimed?.rules[0];
  return rule ? { live: true, rule } : { live: true };
}

/** Keys of present records whose freshly claimed rule no longer matches
 *  them (e.g. a new container IP after a container restart). A key with no claim
 *  at all is `reap`'s business, not stale. */
export function staleKeys(
  records: readonly TunnelDesiredRecord[],
  discovery: ClaimedDiscovery,
): Set<string> {
  const stale = new Set<string>();
  for (const record of records) {
    if (record.desired !== 'present') continue;
    const rule = discovery.services
      .find((s) => s.key === record.key)
      ?.rules.find((r) => r.key === record.key);
    if (rule && !recordMatchesRule(record, rule)) stale.add(record.key);
  }
  return stale;
}

/** BB-681 review M6: Quick's URL is a real `trycloudflare.com` allocation,
 *  with no fixed-name/uptime guarantee — flag it here so `status` itself
 *  surfaces the limitation, not only the README. BB-681 review N8: state
 *  only validates `url` as a string, never as a well-formed URL — `status`
 *  must never crash on a malformed stored value. Exported for a unit test. */
export function quickTunnelNotice(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  if (!/\.trycloudflare\.com$/i.test(new URL(url).hostname)) return undefined;
  return 'Quick Tunnel: no fixed name, no uptime guarantee, 200 in-flight request limit, no SSE';
}

const NO_CONDUCTOR =
  'no running conductor for this checkout — the conductor is the only writer of the tunnel routes (start it with `bakers conductor start`)';

/** The live conductor endpoint whose workspace root holds `worktree`; the
 *  most specific root wins. A dead pid's leftover file does not count. */
function conductorEndpoint(
  worktree: string,
): { url: string; operatorToken: string } | undefined {
  const dir = join(homeBbDir(), 'conductors');
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return undefined;
  }
  const alive = (pid: unknown) => {
    try {
      process.kill(pid as number, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  const holds = (root: string) => {
    const rel = relative(resolve(root), resolve(worktree));
    return !rel.startsWith('..') && !isAbsolute(rel);
  };
  const live = names
    .map((n) => {
      try {
        return JSON.parse(readFileSync(join(dir, n), 'utf8'));
      } catch {
        return undefined;
      }
    })
    .filter(
      (e) =>
        typeof e?.url === 'string' &&
        typeof e.operatorToken === 'string' &&
        typeof e.workspaceRoot === 'string' &&
        e.workspaceRoot !== '' &&
        Number.isInteger(e.pid) &&
        alive(e.pid) &&
        holds(e.workspaceRoot),
    )
    .sort((a, b) => b.workspaceRoot.length - a.workspaceRoot.length);
  return live[0];
}

/** Call a ports tool on `worktree` through the conductor; prints its answer
 *  and sets a failing exit code on an error. Returns the text on success. */
async function viaConductor(
  worktree: string,
  tool: string,
  args: Record<string, unknown>,
  ticket?: string,
  print = true,
): Promise<string | undefined> {
  const fail = (message: string) => {
    process.stdout.write(`${message}\n`);
    process.exitCode = 1;
    return undefined;
  };
  const endpoint = conductorEndpoint(worktree);
  if (!endpoint) return fail(NO_CONDUCTOR);
  let body: { text?: unknown; error?: unknown };
  try {
    const res = await fetch(`${endpoint.url}/call`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${endpoint.operatorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tool,
        args,
        worktree,
        ...(ticket ? { ticket } : {}),
      }),
    });
    body = (await res.json()) as typeof body;
    if (!res.ok) return fail(String(body.error ?? `HTTP ${res.status}`));
  } catch (err) {
    return fail(
      `${NO_CONDUCTOR}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = String(body.text ?? '');
  if (print && text !== '') process.stdout.write(`${text}\n`);
  return text;
}

/** Register `bakers ports <sub>` on the program. Exported for a registration test. */
export function registerPorts(program: Command, worktree: () => string): void {
  const ports = program
    .command('ports')
    .description(
      "list a ticket worktree's claimed services and share them over the named tunnel",
    );

  ports
    .command('list')
    .description('every claimed service of this worktree')
    .option(
      '--ticket <identifier>',
      'ticket identifier, when it cannot be inferred from the branch',
    )
    .action(async (opts: { ticket?: string }) => {
      const wt = worktree();
      try {
        await readPortsSettings(wt);
      } catch (err) {
        process.stdout.write(
          `${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      const cfg = await resolveTransport(wt);
      const ticket = resolveTicketIdentifier(opts.ticket, currentBranch(wt));
      if (!cfg.ok) {
        process.stdout.write(
          `tunnel sharing off (${cfg.message}) — listing only\n`,
        );
      }
      const zone = cfg.ok ? (cfg.transport.zone ?? '') : '';
      if (!ticket.ok) {
        process.stdout.write(`${ticket.message}\n`);
        process.exitCode = 1;
        return;
      }
      const discovery = await discoverOrFail(wt, ticket.identifier, zone);
      if (!discovery) return;
      if (discovery.services.length === 0 && discovery.unclaimed.length === 0) {
        process.stdout.write('No claimed services for this worktree.\n');
        return;
      }
      for (const service of discovery.services) {
        process.stdout.write(`${serviceLine(service)}\n`);
      }
      const dim = Boolean(process.stdout.isTTY);
      for (const port of discovery.unclaimed) {
        process.stdout.write(`${unclaimedLine(port, dim)}\n`);
      }
    });

  ports
    .command('status')
    .description("this worktree's machine tunnel records")
    .action(async () => {
      const text = await viaConductor(
        worktree(),
        'ports_status',
        {},
        undefined,
        false,
      );
      if (text === undefined) return;
      const rows = JSON.parse(text) as {
        service: string;
        status: string;
        url?: string;
        error?: string;
        stale?: boolean;
      }[];
      if (rows.length === 0) {
        process.stdout.write('No tunnels recorded for this worktree.\n');
        return;
      }
      for (const r of rows) {
        const staleMark = r.stale
          ? ' stale (origin changed — run bakers ports up)'
          : '';
        process.stdout.write(
          `${r.service}\t${r.url ?? '-'}\t${r.status}${r.error ? ` (${r.error})` : ''}${staleMark}\n`,
        );
        const notice = quickTunnelNotice(r.url);
        if (notice) process.stdout.write(`  (${notice})\n`);
      }
    });

  ports
    .command('up')
    .description(
      'share one claimed service over the named tunnel, or every eligible one when no key is given',
    )
    .argument(
      '[service]',
      'the claimed service key (or its base name); every eligible service when omitted',
    )
    .option(
      '--ticket <identifier>',
      'ticket identifier, when it cannot be inferred from the branch',
    )
    .action(async (service: string | undefined, opts: { ticket?: string }) => {
      await viaConductor(
        worktree(),
        'ports_up',
        service === undefined ? {} : { service },
        opts.ticket,
      );
    });

  ports
    .command('down')
    .description(
      "take a service's tunnel down, or every tunnel of this worktree",
    )
    .argument(
      '[key]',
      'the service key to stop sharing; every key of this worktree when omitted',
    )
    .action(async (key: string | undefined) => {
      await viaConductor(
        worktree(),
        'ports_down',
        key === undefined ? {} : { service: key },
      );
    });

  ports
    .command('reap')
    .description(
      'reconcile machine-wide tunnel records and kill orphaned legacy tunnel processes',
    )
    .action(async () => {
      // The route reconcile runs in the conductor; a failure there still
      // lets the host-local legacy cleanup below run.
      await viaConductor(worktree(), 'ports_reap', {});

      let killed = 0;
      for (const proc of await listCloudflaredProcesses()) {
        // Only a legacy `tunnel --url …` quick tunnel, never the machine's
        // named `tunnel run` connector (plan review focus 4).
        if (!proc.cmdline.includes('--url')) continue;
        const legacyPids = proc.deleted
          ? null
          : await readLegacyTunnelPids(proc.cwd);
        if (!isLegacyKillCandidate(proc, legacyPids)) continue;
        if (!(await isOwnedByCurrentUser(proc.pid))) continue;
        // Revalidate identity immediately before SIGTERM (plan review focus
        // 4) — see `revalidatesForKill`'s doc comment.
        const fresh = await nodeDeps.processInfo(proc.pid);
        const freshStartTime = await processStartTime(proc.pid);
        if (!revalidatesForKill(fresh, freshStartTime, proc)) continue;
        try {
          process.kill(proc.pid, 'SIGTERM');
          killed += 1;
        } catch {
          // already gone — fine, nothing to revalidate against
        }
      }
      if (killed > 0)
        process.stdout.write(`killed ${killed} legacy tunnel process(es)\n`);
    });
}

const portsCommandPlugin: BbCommandPlugin = {
  kind: 'command',
  name: 'ports',
  describe:
    "list a ticket worktree's claimed services and share them over the named tunnel",
  register(program: Command, _host: BbCommandHost): void {
    registerPorts(program, () => process.cwd());
  },
};

export default portsCommandPlugin;
