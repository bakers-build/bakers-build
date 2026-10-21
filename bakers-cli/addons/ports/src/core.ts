// BB-475 — the ports package's pure surface, free of the command wiring.
//
// Exported as `@bakers-build/addon-ports/core` so the cockpit package (BB-475 stage
// 6) consumes the discovery, transport and state functions and their types
// WITHOUT pulling in commander or the CLI entry. Discovery and transport are the
// same code the commands run; the cockpit renders their result and drives their
// actions.

export type {
  RawDiagnostic,
  RawDiscovery,
  RawPort,
  Tri,
} from '@bakers-build/addon-ddev';
export {
  type ClaimContext,
  type ClaimedDiscovery,
  type ClaimedService,
  type ClaimStatus,
  claimServices,
  discoverClaimedServices,
  type HttpProbe,
  publicHostname,
  type TunnelRule,
} from './claims.js';
export {
  assertNoMachinePorts,
  loadPortsTransport,
  PORTS_NEEDS_ENTRY,
  PORTS_RETIRED,
  type PortsMachineConfig,
  portsSettings,
  readPortsSettings,
  withProblems,
} from './config.js';
export {
  discoverHostPorts,
  type HostDiscoveryDeps,
  parseSocketListeners,
  type SocketListener,
} from './discovery.js';
export {
  type LockDeps,
  LockTimeoutError,
  nodeLockDeps,
  tunnelLockPath,
  withTunnelLock,
} from './lock.js';
export { readTunnelState, type StateDeps } from './state.js';
export {
  assertPortsTransport,
  InvalidTransportModuleError,
  type PortsTransport,
  type PortsTransportFactory,
} from './transport.js';
export {
  bringUp as bringUpTunnel,
  type OperationContext,
  type OpResult as TunnelOpResult,
  type ReapResult as TunnelReapResult,
  readTunnelState as readMachineTunnelRecords,
  reap as reapTunnels,
  reconcileTunnels,
  type TunnelOpsDeps,
  takeDown as takeDownTunnel,
} from './tunnel-ops.js';
export {
  assertIdentity,
  emptyState,
  type MachineTunnelState,
  nodeTunnelStateDeps,
  type ReadResult,
  readMachineTunnelState,
  readValidatedMachineState,
  type TunnelDesiredRecord,
  type TunnelIdentity,
  TunnelIdentityMismatchError,
  type TunnelStateDeps,
  tunnelStatePath,
  upsertRecord,
  writeMachineTunnelState,
} from './tunnel-state.js';
export type { TunnelRecord, TunnelState } from './types.js';
