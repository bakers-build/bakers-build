// BB-681 review I6 — the spec names `@bakers-build/addon-ports/transport` as the
// transport contract's export path; implementations imported it from
// `/core` instead, which also pulls in the entire command/discovery/state
// surface a transport package has no business depending on. This subpath
// re-exports exactly what a `PortsTransport` implementation needs: the
// contract itself and the one state-shape helper (`upsertRecord`) every
// built-in transport already uses to patch its own record.

export {
  assertPortsTransport,
  InvalidTransportModuleError,
  type PortsTransport,
  type PortsTransportFactory,
} from './transport.js';
export {
  type TunnelDesiredRecord,
  upsertRecord,
} from './tunnel-state.js';
