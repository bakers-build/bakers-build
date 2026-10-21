// BB-475 — the domain of the ports command package.
//
// Pure types, no I/O: discovery, transport and state each take an injected
// deps object (the `ConductorProcessHost` pattern) so a test drives them with
// captured command output and substituted process spawning, and never starts
// a tunnel or reads a real socket table.
//
// BB-676 spec v2: `RawPort`/`RawDiagnostic`/`RawDiscovery` and the claim
// contract (`ClaimedService`/`TunnelRule`/`ClaimContext`/…) moved to
// `@bakers-build/addon-ddev` — see `claims.ts`'s header comment for why.

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
