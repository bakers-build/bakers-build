// The claim contract is owned by `@bakers-build/addon-ports` (its `./core`
// entry); this package implements its `Claimer` (see `claimer.ts`). The edge
// runs addon-ddev -> addon-ports only.

import type { ClaimContext } from '@bakers-build/addon-ports/core';
import type { DdevHosts } from './hosts.js';

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
} from '@bakers-build/addon-ports/core';
export type { DdevHosts } from './hosts.js';

/** What the DDEV claimer's `discover` hands its own `claim`. */
export interface DdevContext {
  /** `.ddev/config.yaml`'s `web_extra_exposed_ports[].name`, keyed by
   *  `container_port` — the declared name for a non-primary-web service
   *  (vite, xhgui, …) sharing the web container, so a dead/live claim on that
   *  port surfaces under its configured name instead of the web container's
   *  generic `web` compose-service label. */
  readonly webExtraExposedPortNames?: ReadonlyMap<number, string>;
  /** BB-681 Task 1 — the project's effective DDEV hosts (primary +
   *  additional), from `ddev utility configyaml`. Absent/unparseable config
   *  means no individual-host splitting is attempted — the primary `web`
   *  claim alone still works, never invented from a guess. */
  readonly hosts?: DdevHosts;
}

export type DdevClaimContext = ClaimContext & DdevContext;
