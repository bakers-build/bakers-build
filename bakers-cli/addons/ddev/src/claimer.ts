// The DDEV `Claimer` for `@bakers-build/addon-ports` (`with.claimers:
// ['@bakers-build/addon-ddev']`): container discovery, effective hosts and
// `.ddev/config.yaml`'s extra port names, then `claimDdev` over what the
// process claimers left.

import type { Claimer } from '@bakers-build/addon-ports/core';
import { claimDdev } from './claims.js';
import { discoverDdevPorts, parseWebExtraExposedPorts } from './discovery.js';
import { discoverDdevHosts } from './hosts.js';
import type { DdevContext } from './types.js';

export const claimer: Claimer<DdevContext> = {
  async discover(worktree, deps) {
    const [ddev, hostsResult, configYaml] = await Promise.all([
      discoverDdevPorts(worktree, deps),
      discoverDdevHosts(worktree, deps),
      deps.readFile(`${worktree.replace(/\/+$/, '')}/.ddev/config.yaml`),
    ]);
    // BB-681 review I1: a failed `ddev utility configyaml` read must leave a
    // diagnostic, not silently drop every `web-<host>` alias claim — without
    // one, ports' `shouldKeepTunnelRecord` sees no evidence at all for a
    // vanished alias record and `reap` deletes a route that may still be
    // live. Scoped to `web`/`web-*` keys (review N1).
    return {
      ports: ddev.ports,
      diagnostics: [
        ...ddev.diagnostics,
        ...(hostsResult.ok
          ? []
          : [
              {
                source: 'claimer' as const,
                keyPrefix: 'web',
                message: hostsResult.reason,
              },
            ]),
      ],
      context: {
        webExtraExposedPortNames: parseWebExtraExposedPorts(configYaml),
        ...(hostsResult.ok ? { hosts: hostsResult.hosts } : {}),
      },
    };
  },
  claim: claimDdev,
};
