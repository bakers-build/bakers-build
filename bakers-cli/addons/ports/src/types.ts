// BB-475 — the domain of the ports command package.
//
// Pure types, no I/O: discovery, transport and state each take an injected
// deps object (the `ConductorProcessHost` pattern) so a test drives them with
// captured command output and substituted process spawning, and never starts
// a tunnel or reads a real socket table.
//
// `RawPort`/`RawDiagnostic`/`RawDiscovery` and the claim contract
// (`ClaimedService`/`TunnelRule`/`ClaimContext`/…) are owned here; claimer
// packages import them from `@bakers-build/addon-ports/core`.

/**
 * One tunnel the addon brought up — the whole of what the state file records.
 *
 * Its existence in the file IS the tunnel being up; absence means off (spec D3).
 * `pid` is the transport process, `url` the shared address, `startedAt` epoch
 * seconds so a reader can age it without a clock of its own.
 */
export interface TunnelRecord {
  readonly port: number;
  readonly target: string;
  readonly pid: number;
  readonly url: string;
  readonly startedAt: number;
}

/** The state file's whole content — a set of tunnels keyed by their local port. */
export interface TunnelState {
  readonly tunnels: readonly TunnelRecord[];
}

/** One OBSERVATION, not yet a claimed service. A port alone is not an
 *  identity (two containers, two site rules can share one). `RawPort`
 *  carries every piece of evidence a claimer needs, and a missing probe is
 *  `unknown` — never collapsed into `false` — so a permission-denied Docker
 *  query cannot read as "this is dead" and revoke a route that is actually
 *  still live. */
export type Tri = boolean | 'unknown';

export interface RawPort {
  readonly worktree: string;
  readonly containerId?: string;
  readonly containerPort?: number;
  readonly protocol?: 'tcp' | 'udp';
  readonly hostAddress?: string;
  readonly hostPort?: number;
  /** The in-container bind address a listening socket reported, when known —
   *  used to tell Docker's embedded DNS resolver (`127.0.0.11`) apart from a
   *  real service when picking a dead claim's "what IS listening" sibling. */
  readonly address?: string;
  readonly pid?: number;
  readonly cmdline?: string;
  readonly cwd?: string;
  readonly cwdDeleted?: boolean;
  /** The container's IP on its project network, when it has one. */
  readonly containerIp?: string;
  /** The router-side port of an `HTTP_EXPOSE`/`HTTPS_EXPOSE` mapping. */
  readonly routerPort?: number;
  /** Which `*_EXPOSE` var produced this row's router mapping — the only
   *  reliable signal for the target scheme (B): a port that only appears in
   *  `HTTP_EXPOSE` must be dialled over plain HTTP, never HTTPS. */
  readonly exposeScheme?: 'http' | 'https';
  readonly virtualHost?: string;
  /** A service-type label, when a project sets one — the more specific
   *  naming source than `composeService` when it exists. */
  readonly serviceType?: string;
  /** The `com.docker.compose.service` label (`web`, `mailpit`, `phpmyadmin`,
   *  `opensearch`, …) — naming evidence for the claimer. */
  readonly composeService?: string;
  /** `supervisorctl`'s `group:name`, e.g. `webextradaemons:xhgui`. */
  readonly daemon?: string;
  readonly daemonStatus?: 'RUNNING' | 'STOPPED' | 'EXITED' | 'UNKNOWN';
  readonly containerState?: 'running' | 'stopped' | 'unknown';
  /** A real socket was observed bound to this port. */
  readonly listening: Tri;
  /** A router rule claims this port, regardless of whether it listens. */
  readonly exposed: Tri;
  /** The host-bound port `docker inspect`'s `NetworkSettings.Ports` maps this
   *  `containerPort` to (BB-500 passthrough target), when published. */
  readonly hostBoundPort?: number;
}

export interface RawDiagnostic {
  /** `'claimer'`: reported by a configured claimer package, uninterpreted. */
  readonly source: 'host' | 'docker' | 'web-sockets' | 'supervisor' | 'claimer';
  readonly message: string;
  /** Scopes a no-claim record's reap block to keys `keyPrefix` and
   *  `keyPrefix-*`; without it a non-host diagnostic blocks every key. */
  readonly keyPrefix?: string;
  /** D: the container this diagnostic is about, when it is about one in
   *  particular — see `ComposeDiagnostic.containerId` (`@bakers-build/addon-docker-compose`)
   *  for why this narrows reap's blast radius instead of widening it. */
  readonly containerId?: string;
  /** C: true when this `source: 'host'` diagnostic means the WHOLE host
   *  probe (`ss -ltnpH`) failed, blinding every host-backed service at once
   *  — the host-side equivalent of a `containerId`-less Docker diagnostic.
   *  A per-listener host diagnostic (e.g. "no visible owner") is about one
   *  socket, not the whole probe, and must not carry this flag. */
  readonly wholePass?: boolean;
}

export interface RawDiscovery {
  readonly ports: readonly RawPort[];
  readonly diagnostics: readonly RawDiagnostic[];
}

// BB-681 Task 1 — the transport-neutral rule shape: no Cloudflare-specific
// `originRequest.httpHostHeader`/`noTLSVerify` fields here (those stay
// Cloudflare's own translation in `@bakers-build/addon-ports`' `cloudflare.ts`,
// owned by a later task). `service` is a host-reachable HTTP(S) origin URL;
// `hostHeader`/`insecureTls` are the neutral evidence any transport
// (Cloudflare, a future alternative) can translate on its own terms.
export interface TunnelRule {
  readonly key: string;
  readonly service: string;
  readonly hostHeader?: string;
  readonly insecureTls?: boolean;
  /** Plain-HTTP origin of the service container itself
   *  (`http://<container IP>:<containerPort>`), reachable with the public
   *  Host kept; only transports that can dial container IPs (frp) use it. */
  readonly direct?: string;
}

export type ClaimStatus =
  | 'healthy'
  | 'dead'
  | 'stopped'
  | 'not-exposed'
  | 'unknown';

export interface ClaimedService {
  readonly key: string;
  /** The claimer that owns this service — `'process'` (a configured ports
   *  rule), `'node'` (the all-Node rule) or a claimer package's own name. */
  readonly claim: string;
  readonly status: ClaimStatus;
  /** A local address worth opening on this machine. */
  readonly local: string;
  /** Set when the service is shareable but with a known gap (e.g. no login). */
  readonly limitation?: string;
  /** The raw evidence this claim rests on, for `list` and diagnostics. */
  readonly rawPorts: readonly RawPort[];
  /** Empty unless `status === 'healthy'`. */
  readonly rules: readonly TunnelRule[];
}

export interface ClaimedDiscovery {
  readonly services: readonly ClaimedService[];
  /** Surfaced raw-discovery diagnostics — a caller (reap) must be able to
   *  tell "nothing is here" from "the probe itself could not see", so a
   *  denied Docker query cannot read as every service having vanished. */
  readonly diagnostics: readonly RawDiagnostic[];
  /** Every raw identity no claimer picked up — `list` shows these dimmed,
   *  literally "no addon" (spec): visible, but never shareable. */
  readonly unclaimed: readonly RawPort[];
}

/** A single bounded, non-redirecting HTTP probe — injected, never a real fetch here. */
export type HttpProbe = (
  url: string,
  opts: { readonly timeoutMs: number },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
} | null>;

export interface ClaimContext {
  readonly worktree: string;
  readonly ticket: string;
  readonly zone: string;
  readonly probe: HttpProbe;
}
