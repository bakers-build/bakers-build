// BB-676 pass-6 review cleanup — `parseSocketListeners`/`SocketListener`
// live in `@bakers-build/addon-docker-compose` (the lower-level package); routed
// through here because `@bakers-build/addon-ports` may not edge to
// `@bakers-build/addon-docker-compose` directly (see `scripts/assert-acyclic.mjs`).
export {
  parseSocketListeners,
  type SocketListener,
} from '@bakers-build/addon-docker-compose';
export { claimDdev } from './claims.js';
export {
  discoverDdevPorts,
  parseExposeMapping,
  parseWebExtraExposedPorts,
} from './discovery.js';
export type { DdevHosts, DdevHostsDeps, DdevHostsResult } from './hosts.js';
export {
  DdevHostsError,
  discoverDdevHosts,
  normalizeHost,
  parseDdevHosts,
} from './hosts.js';
export type {
  ClaimContext,
  ClaimedDiscovery,
  ClaimedService,
  ClaimStatus,
  HttpProbe,
  RawDiagnostic,
  RawDiscovery,
  RawPort,
  Tri,
  TunnelRule,
} from './types.js';
