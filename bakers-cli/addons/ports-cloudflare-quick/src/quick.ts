// BB-681 Task 4 — Quick Tunnel as a `PortsTransport`: one managed
// `cloudflared tunnel --url …` process PER ROUTE, no zone, no fixed name.
// Unlike Named Cloudflare/frp (a fixed `<ticket>-<key>.<zone>` hostname),
// Quick allocates its own ephemeral `*.trycloudflare.com` URL per process —
// recreating a route MAY hand back a different URL, which is expected, not
// a bug (see README).
//
// Every real I/O seam (spawn, process inspection, fs, kill, clock, sleep) is
// injected via `QuickDeps`, exactly as `cloudflare.ts`'s `fetch` is injected
// — this file is pure logic, unit-tested without touching `/proc` or
// spawning anything real.

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { TunnelDesiredRecord } from '@bakers-build/addon-ports/transport';
import { upsertRecord } from '@bakers-build/addon-ports/transport';

/** The nonsecret identity fields a live/recorded process is matched on. A
 *  bare PID is NEVER sufficient — PIDs get reused — so every comparison
 *  checks all of these together. */
export interface ManagedProcessIdentity {
  readonly pid: number;
  readonly exe: string;
  readonly argv: readonly string[];
  readonly uid: number;
  readonly startTime: number;
  /** Machine boot identity (boot time or boot id) — a PID+startTime pair
   *  from BEFORE a machine reboot must never be mistaken for a match after
   *  one, even if the raw numbers happen to coincide. */
  readonly bootId: string;
}

export interface QuickOrigin {
  readonly service: string;
  readonly hostHeader?: string | undefined;
  readonly insecureTls?: boolean | undefined;
}

/** The allowlisted provider state this transport persists in
 *  `TunnelDesiredRecord.data` — validated by `validateData` in `index.ts`. */
export interface QuickRouteData {
  readonly pid: number;
  readonly exe: string;
  readonly argv: readonly string[];
  readonly uid: number;
  readonly startTime: number;
  readonly bootId: string;
  readonly routeDir: string;
  readonly generation: number;
  readonly origin: QuickOrigin;
}

export function originEquals(a: QuickOrigin, b: QuickOrigin): boolean {
  return (
    a.service === b.service &&
    (a.hostHeader ?? undefined) === (b.hostHeader ?? undefined) &&
    Boolean(a.insecureTls) === Boolean(b.insecureTls)
  );
}

export function identityEquals(
  a: ManagedProcessIdentity,
  b: ManagedProcessIdentity,
): boolean {
  return (
    a.pid === b.pid &&
    a.exe === b.exe &&
    a.uid === b.uid &&
    a.startTime === b.startTime &&
    a.bootId === b.bootId &&
    a.argv.length === b.argv.length &&
    a.argv.every((v, i) => v === b.argv[i])
  );
}

/** Deterministic, collision-proof per-route directory under `BB_HOME`:
 *  worktree+ticket+key hashed together, so two different routes never share
 *  a directory even when a key string repeats across worktrees/tickets. */
export function routeDirFor(
  home: string,
  worktree: string,
  ticket: string,
  key: string,
): string {
  const hash = createHash('sha256')
    .update(`${worktree}\0${ticket}\0${key}`)
    .digest('hex')
    .slice(0, 20);
  return join(home, 'ports', 'quick', hash);
}

export function configPathFor(dir: string, generation: number): string {
  return join(dir, `gen-${generation}`, 'config.yaml');
}

export function logPathFor(dir: string, generation: number): string {
  return join(dir, `gen-${generation}`, 'cloudflared.log');
}

/** Pulls the generation number back out of a recorded `--config` path —
 *  used to rediscover an adopted process's log without trusting any other
 *  recorded state. */
export function generationFromConfigPath(configPath: string): number | null {
  const match = /gen-(\d+)[/\\]config\.yaml$/.exec(configPath);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : null;
}

/** `--no-autoupdate`, explicit `--no-tls-verify=true|false` (never omitted
 *  when it matters — absence must never silently disable verification),
 *  and `--http-host-header` only when the rule carries one. `--logfile` is
 *  REQUIRED, not cosmetic: `waitForUrl` reads the allocated URL only from
 *  this exact generation's log file (BB-681 review C2 — cloudflared never
 *  wrote one here before, so every `up` timed out). Built as an ARGV ARRAY —
 *  never a shell string — so nothing in `origin.service`/`hostHeader` can be
 *  interpreted as a shell metacharacter. */
export function buildArgs(
  configPath: string,
  logPath: string,
  origin: QuickOrigin,
): string[] {
  return [
    '--config',
    configPath,
    '--no-autoupdate',
    '--logfile',
    logPath,
    'tunnel',
    '--url',
    origin.service,
    `--no-tls-verify=${origin.insecureTls ? 'true' : 'false'}`,
    ...(origin.hostHeader ? ['--http-host-header', origin.hostHeader] : []),
  ];
}

/** Reads back the origin `buildArgs` encoded into a live process's argv —
 *  used to tell whether an adopted orphan (recognized only by its
 *  `--config <dir>/…` marker) is actually serving the DESIRED origin before
 *  trusting it (BB-681 review I2 remainder). `null` when the argv carries
 *  no `--url` at all (not one of ours, or a shape this parser predates). */
export function originFromArgv(argv: readonly string[]): QuickOrigin | null {
  const urlIdx = argv.indexOf('--url');
  if (urlIdx === -1 || urlIdx + 1 >= argv.length) return null;
  const service = argv[urlIdx + 1] as string;
  const insecureTls = argv.includes('--no-tls-verify=true');
  const headerIdx = argv.indexOf('--http-host-header');
  const hostHeader =
    headerIdx !== -1 && headerIdx + 1 < argv.length
      ? (argv[headerIdx + 1] as string)
      : undefined;
  return { service, hostHeader, insecureTls };
}

/** Marker byte-for-byte present in every managed quick process's argv (the
 *  `--config <routeDir>/gen-N/config.yaml` pair) — used both to recognize
 *  OUR OWN processes during recovery and to tell the generic legacy-reap
 *  scan (`addons/ports/src/deps-node.ts`) to leave them alone. */
export function isOwnedArgv(argv: readonly string[], dir: string): boolean {
  const idx = argv.indexOf('--config');
  if (idx === -1 || idx + 1 >= argv.length) return false;
  const configPath = argv[idx + 1];
  return typeof configPath === 'string' && configPath.startsWith(`${dir}/`);
}

/** Only a validated `https://<label>.trycloudflare.com` origin is ever
 *  trusted — log-spoofing resistance: any other URL-shaped text in the log
 *  (an attacker-controlled upstream response line, a stray info message) is
 *  rejected, never returned as the live URL. `api.trycloudflare.com` is
 *  cloudflared's OWN allocation-API host, which appears in the log's error
 *  lines (not an allocated tunnel) — explicitly excluded, never matched as a
 *  live route (BB-681 review I4). */
const TRYCLOUDFLARE_RE =
  /\bhttps:\/\/(?!api\.)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com\b/i;

export function parseLiveUrl(log: string): string | null {
  const match = TRYCLOUDFLARE_RE.exec(log);
  return match ? match[0] : null;
}

/** Strips cloudflared tunnel-selection/config/credential overrides the
 *  PARENT environment might carry (`TUNNEL_*`, and cloudflared's own
 *  config-path override) from the CHILD's env — `HOME` itself is NEVER
 *  touched, so the child never redirects to a different (or the user's
 *  real) cloudflared config/credentials on disk. */
export function sanitizeEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    if (/^TUNNEL_/i.test(key)) continue;
    if (key === 'TUNNEL_ORIGIN_CERT' || key === 'CF_API_TOKEN') continue;
    out[key] = value;
  }
  return out;
}

export class AmbiguousOwnershipError extends Error {
  constructor(dir: string, count: number) {
    super(
      `ambiguous ownership for quick tunnel route '${dir}': ${count} candidate owned processes found — refusing to guess which is live (never killing or spawning alongside an ambiguous match)`,
    );
    this.name = 'AmbiguousOwnershipError';
  }
}

export interface QuickDeps {
  /** Spawn the real child — an argv ARRAY, never a shell string. */
  spawn(
    bin: string,
    args: readonly string[],
    opts: {
      readonly cwd: string;
      readonly env: Readonly<Record<string, string>>;
    },
  ): { readonly pid: number };
  /** Resolved path to the `cloudflared` binary, or `null` if missing. */
  findBinary(): Promise<string | null>;
  now(): number;
  /** Resolves early if `signal` aborts mid-sleep — never leaves an abort
   *  waiting out the full duration. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** `null` when the file doesn't exist yet (not spawned, or log not yet
   *  flushed) — never an error for this case. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Scans the WHOLE process table for anything whose argv carries this
   *  route's `--config` marker (see `isOwnedArgv`) — the ground truth used
   *  for crash recovery, independent of anything recorded in `data`. */
  listOwnedProcesses(dir: string): Promise<readonly ManagedProcessIdentity[]>;
  /** Generation numbers with a `gen-N` directory already on disk under
   *  `dir` — read ONLY to pick the next unused generation (BB-681 review
   *  N7); a route's directory outlives `down`, so `recorded` alone is not
   *  enough to avoid reusing a previous life's generation/log. */
  listGenerations(dir: string): Promise<readonly number[]>;
  /** Direct re-check of a single remembered pid — `null` if gone or if the
   *  pid now belongs to an unrelated process (PID reuse is the caller's
   *  concern via `identityEquals`, not this method's). */
  getProcessIdentity(pid: number): Promise<ManagedProcessIdentity | null>;
  kill(pid: number): void;
  /** Resolves once the pid is confirmed gone, or `signal` aborts/deadline
   *  elapses — termination is only reported back once ACTUALLY confirmed,
   *  never merely "signal sent". */
  waitExit(
    pid: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean>;
  bootId(): Promise<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly urlWaitMs: number;
  readonly pollMs: number;
  readonly killWaitMs: number;
}

interface OneResult {
  readonly record: TunnelDesiredRecord;
  readonly ok: boolean;
}

function dataOf(record: TunnelDesiredRecord): QuickRouteData | undefined {
  return record.data as QuickRouteData | undefined;
}

/** Returns `true` only once the process is CONFIRMED gone (already gone, or
 *  killed and `waitExit` confirmed it) — `false` when a kill was sent but
 *  exit never confirmed within the deadline. BB-681 review I2 (remainder):
 *  callers must not spawn a fresh generation while an old one might still be
 *  alive, racing to route the same key. */
async function terminateOwned(
  deps: QuickDeps,
  identity: ManagedProcessIdentity,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  // Revalidate immediately before signalling — never trust a remembered pid
  // alone; a PID-reuse scenario (same number, different identity) must read
  // as "already gone", never as permission to kill whatever runs there now.
  const fresh = await deps.getProcessIdentity(identity.pid);
  if (!fresh || !identityEquals(fresh, identity)) return true;
  deps.kill(identity.pid);
  return deps.waitExit(identity.pid, deps.killWaitMs, signal);
}

/** Finds this route's single owned process, if any — the authoritative
 *  ground truth crash recovery relies on (never just a recorded pid). */
async function findOwned(
  deps: QuickDeps,
  dir: string,
): Promise<ManagedProcessIdentity | null> {
  const owned = await deps.listOwnedProcesses(dir);
  if (owned.length > 1) throw new AmbiguousOwnershipError(dir, owned.length);
  return owned[0] ?? null;
}

async function waitForUrl(
  deps: QuickDeps,
  logPath: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const deadline = deps.now() + deps.urlWaitMs;
  for (;;) {
    if (signal?.aborted) return null;
    const log = await deps.readFile(logPath);
    if (log) {
      const url = parseLiveUrl(log);
      if (url) return url;
    }
    if (deps.now() >= deadline) return null;
    await deps.sleep(deps.pollMs, signal);
  }
}

async function spawnGeneration(
  deps: QuickDeps,
  bin: string,
  dir: string,
  generation: number,
  origin: QuickOrigin,
): Promise<QuickRouteData> {
  const genDir = join(dir, `gen-${generation}`);
  await deps.mkdir(genDir);
  const configPath = configPathFor(dir, generation);
  // An empty `{}` config isolates the child from any user-level cloudflared
  // config on disk — the only thing `--config` is here for.
  await deps.writeFile(configPath, '{}\n');
  const args = buildArgs(configPath, logPathFor(dir, generation), origin);
  const env = sanitizeEnv(deps.env);
  const child = deps.spawn(bin, args, { cwd: genDir, env });
  const identity = await deps.getProcessIdentity(child.pid);
  const bootId = await deps.bootId();
  if (!identity) {
    // The process already exited before we could even inspect it.
    return {
      pid: child.pid,
      exe: bin,
      argv: args,
      uid: -1,
      startTime: -1,
      bootId,
      routeDir: dir,
      generation,
      origin,
    };
  }
  return { ...identity, routeDir: dir, generation, origin };
}

async function reconcilePresent(
  record: TunnelDesiredRecord,
  deps: QuickDeps,
  home: string,
  context: { readonly signal?: AbortSignal | undefined },
): Promise<QuickRouteData | { error: string }> {
  const dir = routeDirFor(home, record.worktree, record.ticket, record.key);
  const origin: QuickOrigin = {
    service: record.service,
    hostHeader: record.hostHeader,
    insecureTls: record.insecureTls,
  };
  const recorded = dataOf(record);

  // Direct re-check of the REMEMBERED pid, never a bare PID match: a UID
  // mismatch or PID reuse (same number, different exe/startTime/bootId)
  // means the recorded pid is NOT ours any more — treated as "our process
  // is gone", never as permission to touch whatever now runs there.
  let liveRecorded: ManagedProcessIdentity | null = null;
  if (recorded) {
    const fresh = await deps.getProcessIdentity(recorded.pid);
    if (fresh && identityEquals(fresh, recorded)) {
      liveRecorded = fresh;
      if (originEquals(recorded.origin, origin)) {
        // Fast path: a live, matching, owned process — reuse it, never
        // spawn a duplicate alongside it.
        return { ...recorded, pid: fresh.pid };
      }
    }
  }

  if (liveRecorded) {
    // Confirmed ours, but the origin changed — terminate before the new
    // generation starts, so two processes never route the same key. An
    // UNCONFIRMED termination must stop here, not fall through to spawn
    // alongside a possibly still-live old process (BB-681 review I2).
    const confirmed = await terminateOwned(deps, liveRecorded, context.signal);
    if (!confirmed) {
      return { error: 'termination of the previous process not yet confirmed' };
    }
  } else {
    // Either no recorded data at all (first-ever reconcile for this route,
    // OR a crash before the very first checkpoint), or recorded data existed
    // but its pid is gone/reused. BB-681 review I2: scan for an orphan
    // bearing this route's marker in BOTH cases, not only the no-recorded
    // one — a crash after checkpointing generation N+1 but before THAT
    // process's own next reconcile leaves it running, unmatched by
    // `recorded` (whose pid may since have been reused), and the old code
    // spawned a second, duplicate-routing generation N+2 alongside it. An
    // AMBIGUOUS match (more than one candidate) is an error state, never
    // permission to kill or spawn alongside it — `findOwned` throws for
    // that, and the caller surfaces it as a failed record.
    const owned = await findOwned(deps, dir);
    if (owned) {
      const generation = generationFromConfigPath(
        owned.argv[owned.argv.indexOf('--config') + 1] ?? '',
      );
      // BB-681 review I2 (remainder): an orphan is recognized only by its
      // `--config <dir>/…` marker, not by the ORIGIN it was actually
      // launched with — adopting it unconditionally with the DESIRED origin
      // would silently keep routing a stale service/host-header/TLS setting.
      // Read the origin back out of its OWN argv and compare.
      const ownedOrigin = originFromArgv(owned.argv);
      const originMatches =
        ownedOrigin !== null && originEquals(ownedOrigin, origin);
      if (originMatches) {
        return {
          ...owned,
          routeDir: dir,
          generation: generation ?? 1,
          origin,
        };
      }
      // A mismatched orphan must be terminated — CONFIRMED — before a fresh
      // generation spawns, so two processes never route the same key.
      const confirmed = await terminateOwned(deps, owned, context.signal);
      if (!confirmed) {
        return {
          error: 'termination of the previous process not yet confirmed',
        };
      }
    }
  }

  const bin = await deps.findBinary();
  if (!bin) return { error: 'cloudflared binary not found' };

  // BB-681 review N7: `recorded` is undefined both on a route's first-ever
  // spawn AND after `down`/a timeout clears it — but the route DIRECTORY
  // (hashed from worktree+ticket+key) is never deleted, so generation 1's
  // log from a PREVIOUS life can still sit on disk. Starting from the
  // highest generation actually present there (not just `recorded`) always
  // lands on a brand-new, never-before-written directory, so `waitForUrl`
  // can never read a dead generation's stale URL.
  const existing = await deps.listGenerations(dir);
  const highestOnDisk = existing.length > 0 ? Math.max(...existing) : 0;
  const generation = Math.max(recorded?.generation ?? 0, highestOnDisk) + 1;
  const spawned = await spawnGeneration(deps, bin, dir, generation, origin);
  return spawned;
}

function recordWithData(
  record: TunnelDesiredRecord,
  data: QuickRouteData,
  patch: Partial<TunnelDesiredRecord>,
): TunnelDesiredRecord {
  return {
    ...record,
    data: data as unknown as Record<string, unknown>,
    ...patch,
  };
}

async function reconcileOnePresent(
  record: TunnelDesiredRecord,
  deps: QuickDeps,
  home: string,
  context: {
    readonly signal?: AbortSignal | undefined;
    checkpoint(records: readonly TunnelDesiredRecord[]): Promise<void>;
  },
  commit: (next: TunnelDesiredRecord) => Promise<void>,
): Promise<OneResult> {
  let outcome: QuickRouteData | { error: string };
  try {
    outcome = await reconcilePresent(record, deps, home, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next = { ...record, applied: 'error' as const, error: message };
    return { record: next, ok: false };
  }
  if ('error' in outcome) {
    const next = { ...record, applied: 'error' as const, error: outcome.error };
    return { record: next, ok: false };
  }
  const data = outcome;
  // Checkpoint ownership BEFORE waiting for the URL — a crash between spawn
  // and this point must never lose track of a process we just started.
  const pending = recordWithData(record, data, {
    applied: 'pending',
    error: undefined,
  });
  try {
    await commit(pending);
  } catch (err) {
    // Checkpoint failure: the process (if freshly spawned) keeps running
    // unkilled — the next reconcile's routeDir scan will find and adopt it.
    // Report this attempt as failed without touching the process.
    const message = err instanceof Error ? err.message : String(err);
    return {
      record: { ...record, applied: 'error', error: message },
      ok: false,
    };
  }

  // Only trust the PREVIOUSLY recorded URL when this is the exact same
  // generation/pid as before (the fast-path reuse case) — a fresh spawn
  // (even one whose desired origin happens to equal itself, which is
  // tautological) always gets its URL re-read from ITS OWN generation's log.
  const recordedBefore = dataOf(record);
  const sameGeneration =
    recordedBefore !== undefined &&
    recordedBefore.pid === data.pid &&
    recordedBefore.generation === data.generation &&
    recordedBefore.routeDir === data.routeDir;
  const url = sameGeneration ? record.url : undefined;

  const resolvedUrl =
    url ??
    (await waitForUrl(
      deps,
      logPathFor(data.routeDir, data.generation),
      context.signal,
    ));

  if (context.signal?.aborted && !resolvedUrl) {
    // Aborted mid-wait: stop cleanly, don't terminate the legitimately
    // started process, just report "not yet live" for this pass.
    return { record: pending, ok: false };
  }

  if (!resolvedUrl) {
    // Bounded timeout: terminate ONLY the process just established by THIS
    // spawn — never an unrelated process.
    const fresh = await deps.getProcessIdentity(data.pid);
    if (fresh && identityEquals(fresh, data)) {
      deps.kill(data.pid);
      await deps.waitExit(data.pid, deps.killWaitMs, context.signal);
    }
    return {
      record: {
        ...record,
        data: undefined,
        applied: 'error',
        error: 'timed out waiting for the Quick Tunnel URL',
      },
      ok: false,
    };
  }

  return {
    record: recordWithData(record, data, {
      applied: 'applied',
      error: undefined,
      url: resolvedUrl,
    }),
    ok: true,
  };
}

async function reconcileOneAbsent(
  record: TunnelDesiredRecord,
  deps: QuickDeps,
  home: string,
  context: { readonly signal?: AbortSignal | undefined },
): Promise<OneResult> {
  const dir = routeDirFor(home, record.worktree, record.ticket, record.key);
  const recorded = dataOf(record);

  let target: ManagedProcessIdentity | null = null;
  if (recorded) {
    // Direct re-check of the remembered pid — a UID mismatch/PID reuse
    // reads as "already gone", never as permission to kill the impostor.
    const fresh = await deps.getProcessIdentity(recorded.pid);
    if (fresh && identityEquals(fresh, recorded)) target = fresh;
  }
  if (!target) {
    // BB-681 review R4-M1: a crash between spawning a generation and
    // checkpointing it left `recorded` stale (gone/reused pid) OR entirely
    // absent — either way the route directory can still hold a live, owned
    // orphan. Scanning only the no-`recorded` case let that orphan outlive
    // a tombstone drop, keeping its tunnel publicly reachable with nothing
    // left tracking it. Scan whenever the direct re-check didn't confirm a
    // live owned process, not only when nothing was ever recorded.
    try {
      target = await findOwned(deps, dir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        record: { ...record, applied: 'error', error: message },
        ok: false,
      };
    }
  }

  if (target) {
    await terminateOwned(deps, target, context.signal);
    const stillThere = await deps.getProcessIdentity(target.pid);
    if (stillThere && identityEquals(stillThere, target)) {
      // Termination not yet confirmed — keep the tombstone, don't drop it.
      return {
        record: {
          ...record,
          applied: 'error',
          error: 'termination not yet confirmed',
        },
        ok: false,
      };
    }
  }
  // Confirmed gone (or never existed) — safe to drop the tombstone entirely.
  return {
    record: {
      ...record,
      desired: 'absent',
      applied: 'applied',
      data: undefined,
    },
    ok: true,
  };
}

/** `PortsTransport.reconcile` for Quick: no DNS/ingress phase — each
 *  record's remote state IS its own managed process. */
export async function reconcileQuick(
  records: readonly TunnelDesiredRecord[],
  deps: QuickDeps,
  home: string,
  context: {
    readonly signal?: AbortSignal | undefined;
    checkpoint(records: readonly TunnelDesiredRecord[]): Promise<void>;
  },
): Promise<{
  readonly records: readonly TunnelDesiredRecord[];
  readonly ok: boolean;
}> {
  let next = records;
  let ok = true;

  const commit = async (updated: TunnelDesiredRecord) => {
    next = upsertRecord(next, updated);
    await context.checkpoint(next);
  };

  for (const record of records) {
    if (record.desired === 'present') {
      const result = await reconcileOnePresent(
        record,
        deps,
        home,
        context,
        commit,
      );
      next = upsertRecord(next, result.record);
      if (!result.ok) ok = false;
    }
  }

  const absentIds: string[] = [];
  for (const record of next) {
    if (record.desired !== 'absent') continue;
    const result = await reconcileOneAbsent(record, deps, home, context);
    if (result.ok) {
      absentIds.push(`${record.worktree}:${record.key}`);
    } else {
      next = upsertRecord(next, result.record);
      ok = false;
    }
  }
  next = next.filter(
    (r) =>
      !(r.desired === 'absent' && absentIds.includes(`${r.worktree}:${r.key}`)),
  );

  return { records: next, ok };
}
