// BB-681 Task 3 — `PortsTransport.reconcile` for frp: write the complete
// desired proxy list to the ONE file this addon owns (`routes.json`), then
// drive the local admin API (reload, then poll status) until every intended
// proxy is confirmed running/absent. Desired intent stays `pending` until
// that full confirmation (spec) — a reload returning HTTP 200 is never
// treated as success by itself.

import { createHash, randomUUID } from 'node:crypto';
import type { TunnelDesiredRecord } from '@bakers-build/addon-ports/transport';
import { upsertRecord } from '@bakers-build/addon-ports/transport';
import { directOrigin, type FrpProxy, toFrpProxy } from './frp.js';

/** The injectable seams (TDD deps pattern, matching `addon-ports-cloudflare`'s
 *  `CloudflareDeps` / `addon-ports`'s `TunnelStateDeps`): fs, fetch, clock,
 *  delay — nothing here calls `node:fs`/`fetch`/`setTimeout` directly. */
export interface FrpDeps {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  fetch(
    url: string,
    init: {
      readonly method: string;
      readonly headers: Readonly<Record<string, string>>;
    },
  ): Promise<{
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
  }>;
  now(): number;
  delay(ms: number): Promise<void>;
  /** Bounded TCP connect — can this host reach a container IP at all? */
  canConnect(host: string, port: number, timeoutMs: number): Promise<boolean>;
}

const DIRECT_PROBE_TIMEOUT_MS = 1500;

export interface FrpReconcileConfig {
  readonly routesPath: string;
  readonly identity: string;
  readonly adminBase: string;
  readonly adminUser: string;
  readonly adminPassword: string;
  /** Bounded status-poll deadline/interval — never an unbounded wait. */
  readonly pollTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

// BB-681 review C3: frpc 0.68.0 decodes every `includes` file strictly
// (`RejectUnknownMembers: strict`, matching this client's own reload
// `strictConfig=true`) into `v1.ClientConfig` — an `owner`/`identity`/
// `generation` top-level key is unknown there and the whole include is
// rejected. The file holds ONLY what frpc's schema allows; ownership/
// generation tracking moves to the content hash below plus the ALREADY
// recorded `record.data.generation` (`lastAcknowledgedGeneration`).
interface RoutesFile {
  readonly proxies: readonly FrpProxy[];
}

/** BB-681 review N4: unparseable content and a parseable-but-`proxies`-less
 *  object must NOT collapse onto the same shape as a legitimately empty
 *  `{proxies: []}` this client wrote itself after its last route was
 *  removed — both would hash identically and a truly foreign file could be
 *  silently overwritten whenever the desired/acknowledged generation also
 *  happens to be empty. `'malformed'` is reported as foreign unconditionally,
 *  never folded into a generation comparison. */
type ReadRoutesResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'ok'; readonly proxies: readonly FrpProxy[] };

/** One frpc admin `/api/status` row — ponytail: plausible frpc 0.68.0 shape
 *  (name/status/err per proxy, grouped by type), not a verified capture. */
interface FrpStatusRow {
  readonly name: string;
  readonly status: string;
  readonly err?: string;
}
type FrpStatusResponse = Record<string, readonly FrpStatusRow[] | undefined>;

function flattenStatus(body: FrpStatusResponse): Map<string, string> {
  const byName = new Map<string, string>();
  for (const rows of Object.values(body)) {
    for (const row of rows ?? []) byName.set(row.name, row.status);
  }
  return byName;
}

/** Deterministic fingerprint of (identity, desired proxy set) — the
 *  ownership marker written into routes.json alongside the content it
 *  describes, so a later reconcile can tell "this generation" apart from a
 *  foreign file without needing a lock held across process restarts.
 *  ponytail: content hash, not a counter — simplest thing that is stable
 *  for an unchanged desired set and changes whenever it doesn't. */
export function computeGeneration(
  identity: string,
  proxies: readonly FrpProxy[],
): string {
  const sorted = [...proxies].sort((a, b) => a.name.localeCompare(b.name));
  return createHash('sha256')
    .update(`${identity}\n${JSON.stringify(sorted)}`)
    .digest('hex')
    .slice(0, 16);
}

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function readRoutesFile(
  path: string,
  deps: FrpDeps,
): Promise<ReadRoutesResult> {
  let raw: string;
  try {
    raw = await deps.readFile(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'absent' };
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'malformed' };
  }
  const proxies = (parsed as { proxies?: unknown } | null)?.proxies;
  if (!Array.isArray(proxies)) return { kind: 'malformed' };
  // Exactly what this addon writes after its last route is gone: nothing to
  // protect, so a new identity (e.g. after a zone change) may take it over.
  if (proxies.length === 0 && Object.keys(parsed as object).length === 1) {
    return { kind: 'absent' };
  }
  return { kind: 'ok', proxies: proxies as FrpProxy[] };
}

async function writeRoutesFile(
  path: string,
  dir: string,
  content: RoutesFile,
  deps: FrpDeps,
): Promise<void> {
  await deps.mkdir(dir);
  const tmp = `${path}.${randomUUID()}.tmp`;
  await deps.writeFile(tmp, `${JSON.stringify(content, null, 2)}\n`, 0o600);
  await deps.rename(tmp, path);
}

function lastAcknowledgedGeneration(
  records: readonly TunnelDesiredRecord[],
): string | undefined {
  for (const r of records) {
    const g = r.data?.generation;
    if (typeof g === 'string') return g;
  }
  return undefined;
}

export async function reconcileFrp(
  records: readonly TunnelDesiredRecord[],
  cfg: FrpReconcileConfig,
  deps: FrpDeps,
  context: {
    checkpoint(records: readonly TunnelDesiredRecord[]): Promise<void>;
  },
): Promise<{
  readonly records: readonly TunnelDesiredRecord[];
  readonly ok: boolean;
}> {
  let next = records;
  let ok = true;
  const active = next.filter((r) => r.desired === 'present');
  // A tombstone that never had a route written (no `data.generation` ever
  // recorded) has nothing to confirm removed — drop it immediately, same as
  // `addon-ports-cloudflare`'s "no-op absent" handling.
  const noOpAbsentKeys = new Set(
    next
      .filter(
        (r) => r.desired === 'absent' && typeof r.data?.generation !== 'string',
      )
      .map((r) => `${r.worktree}:${r.key}`),
  );
  next = next.filter(
    (r) =>
      !(r.desired === 'absent' && noOpAbsentKeys.has(`${r.worktree}:${r.key}`)),
  );
  const absentWithRoute = next.filter((r) => r.desired === 'absent');

  if (active.length === 0 && absentWithRoute.length === 0) {
    // Nothing to reconcile (every tombstone was a no-op) — no file write,
    // no reload, no poll.
    return { records: next, ok: true };
  }

  // 1) Translate every active record; a bad candidate (e.g. an unverified
  // HTTPS origin) is excluded and marked 'error' — siblings still ride along
  // (never truncate the whole file for one bad record).
  const proxies: FrpProxy[] = [];
  const proxyByKey = new Map<string, FrpProxy>();
  for (const record of active) {
    try {
      // No fallback to the router path: a host that cannot reach container
      // IPs (Docker Desktop) gets an error instead of a dead route.
      const direct = directOrigin(record);
      if (
        direct &&
        !(await deps.canConnect(
          direct.host,
          direct.port,
          DIRECT_PROBE_TIMEOUT_MS,
        ))
      ) {
        throw new Error(
          `${record.hostname}: direct container routing needs a host that reaches Docker container IPs (${direct.host}:${direct.port} is unreachable) — on macOS use OrbStack`,
        );
      }
      const proxy = toFrpProxy(record);
      proxies.push(proxy);
      proxyByKey.set(`${record.worktree}:${record.key}`, proxy);
    } catch (err) {
      ok = false;
      next = upsertRecord(next, {
        ...record,
        applied: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (active.length > 0 && proxies.length === 0) {
    // Every candidate failed translation: nothing valid to submit. Preserve
    // whatever routes.json currently holds — do not write an empty file.
    return { records: next, ok };
  }

  const desiredGeneration = computeGeneration(cfg.identity, proxies);
  const lastGeneration = lastAcknowledgedGeneration(records);

  const dir = cfg.routesPath.slice(0, cfg.routesPath.lastIndexOf('/'));
  const existing = await readRoutesFile(cfg.routesPath, deps);
  // The file carries no identity/generation of its own (C3) — its content
  // hash, folded with THIS client's identity, stands in for the stored
  // fingerprint. A foreign file (wrong identity, or any content this client
  // never wrote) hashes to neither the desired nor the last-acknowledged
  // generation and is refused exactly as before. Unparseable/`proxies`-less
  // content is ALWAYS foreign (N4) — never folded into that hash comparison,
  // where it could coincidentally match a legitimately empty generation.
  const existingGeneration =
    existing.kind === 'ok'
      ? computeGeneration(cfg.identity, existing.proxies)
      : undefined;
  const isForeign =
    existing.kind === 'malformed' ||
    (existing.kind === 'ok' &&
      existingGeneration !== desiredGeneration &&
      existingGeneration !== lastGeneration);
  if (isForeign) {
    // Foreign file (or one this client didn't write, or doesn't recognise
    // from the last acknowledged/current generation) — refuse to clobber it.
    ok = false;
    const okKeys = new Set(proxyByKey.keys());
    for (const record of active) {
      const key = `${record.worktree}:${record.key}`;
      if (!okKeys.has(key)) continue;
      next = upsertRecord(next, {
        ...record,
        applied: 'error',
        error: `${cfg.routesPath} does not match this client's identity/generation — refusing to overwrite a file it may not own`,
      });
    }
    return { records: next, ok };
  }

  // 2) Write the complete desired set atomically (temp file + rename, 0600
  // — same atomic-write idiom as `tunnel-state.ts`'s `writeMachineTunnelState`).
  try {
    await writeRoutesFile(cfg.routesPath, dir, { proxies }, deps);
  } catch (err) {
    ok = false;
    const message = err instanceof Error ? err.message : String(err);
    for (const record of active) {
      if (!proxyByKey.has(`${record.worktree}:${record.key}`)) continue;
      next = upsertRecord(next, {
        ...record,
        applied: 'pending',
        error: message,
      });
    }
    return { records: next, ok };
  }

  // The file write succeeded: every submitted record carries this
  // generation from now on, and stays `pending` until status-confirmed.
  for (const record of active) {
    if (!proxyByKey.has(`${record.worktree}:${record.key}`)) continue;
    next = upsertRecord(next, {
      ...record,
      applied: 'pending',
      error: undefined,
      data: { generation: desiredGeneration },
    });
  }
  // BB-681 review M5: an unhandled checkpoint failure used to throw
  // straight through `bringUp` into an unhandled rejection at the CLI/inbox
  // entry point, instead of reporting a normal failed-record result — the
  // routes.json write above already succeeded, so the intent is durable on
  // disk; only the durable ACKNOWLEDGEMENT of it failed here, same failure
  // class as Quick's own checkpoint-failure handling.
  try {
    await context.checkpoint(next);
  } catch (err) {
    ok = false;
    const message = err instanceof Error ? err.message : String(err);
    for (const record of active) {
      if (!proxyByKey.has(`${record.worktree}:${record.key}`)) continue;
      next = upsertRecord(next, {
        ...record,
        applied: 'error',
        error: message,
      });
    }
    return { records: next, ok };
  }

  // 3) Reload, then poll `/api/status` with a bounded deadline. A reload
  // HTTP 200 is NOT success by itself — only a subsequent status poll that
  // confirms every intended proxy running/absent marks intent applied.
  const authHeader = basicAuthHeader(cfg.adminUser, cfg.adminPassword);
  try {
    const res = await deps.fetch(
      `${cfg.adminBase}/api/reload?strictConfig=true`,
      {
        method: 'GET',
        headers: { authorization: authHeader },
      },
    );
    if (!res.ok) throw new Error(`reload failed: HTTP ${res.status}`);
  } catch (err) {
    ok = false;
    const message = err instanceof Error ? err.message : String(err);
    for (const record of active) {
      if (!proxyByKey.has(`${record.worktree}:${record.key}`)) continue;
      next = upsertRecord(next, {
        ...record,
        applied: 'pending',
        error: message,
      });
    }
    return { records: next, ok };
  }

  const pollTimeoutMs = cfg.pollTimeoutMs ?? 10_000;
  const pollIntervalMs = cfg.pollIntervalMs ?? 500;
  const deadline = deps.now() + pollTimeoutMs;
  const wantRunningKeys = new Set(proxyByKey.keys());
  const wantGoneNames = new Set(
    absentWithRoute.map((r) => `${r.ticket}-${r.key}`),
  );
  let statusByName = new Map<string, string>();
  for (;;) {
    try {
      const res = await deps.fetch(`${cfg.adminBase}/api/status`, {
        method: 'GET',
        headers: { authorization: authHeader },
      });
      if (res.ok)
        statusByName = flattenStatus((await res.json()) as FrpStatusResponse);
    } catch {
      // A transient status-probe failure just means "not confirmed yet" —
      // the bounded loop below decides when to give up, this never throws.
    }
    const allRunning = [...wantRunningKeys].every((key) => {
      const proxy = proxyByKey.get(key);
      return proxy !== undefined && statusByName.get(proxy.name) === 'running';
    });
    const allGone = [...wantGoneNames].every((name) => !statusByName.has(name));
    if (allRunning && allGone) break;
    if (deps.now() >= deadline) break;
    await deps.delay(pollIntervalMs);
  }

  for (const record of active) {
    const key = `${record.worktree}:${record.key}`;
    const proxy = proxyByKey.get(key);
    if (!proxy) continue;
    if (statusByName.get(proxy.name) === 'running') {
      next = upsertRecord(next, {
        ...record,
        applied: 'applied',
        error: undefined,
        url: `https://${record.hostname}`,
        data: { generation: desiredGeneration },
      });
    } else {
      ok = false;
      next = upsertRecord(next, {
        ...record,
        applied: 'pending',
        error: 'proxy not confirmed running within deadline',
        data: { generation: desiredGeneration },
      });
    }
  }

  for (const record of absentWithRoute) {
    const name = `${record.ticket}-${record.key}`;
    if (!statusByName.has(name)) {
      // Confirmed gone — clear the tombstone entirely.
      next = next.filter(
        (r) => !(r.worktree === record.worktree && r.key === record.key),
      );
    } else {
      ok = false;
      next = upsertRecord(next, {
        ...record,
        applied: 'pending',
        error: 'proxy still reported running — removal not yet confirmed',
      });
    }
  }

  return { records: next, ok };
}
