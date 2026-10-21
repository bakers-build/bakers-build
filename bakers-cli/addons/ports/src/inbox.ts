// BB-676 Task 4 — the ports addon's contract-2 handler (BB-661): a single
// `tunnel` message claims every eligible service of the worktree and shares
// each one not yet applied, then answers with one Markdown list.
//
// Only a claim with `rules.length > 0` is ever shared — an unknown, dead,
// stopped or not-exposed service never reaches `bringUp` (spec "Addon
// claims": "No unclaimed tunnels"). Liveness is read from the machine's
// APPLIED state, never a per-route PID — a route is up because its record
// says so, not because some process on this host answers to a signal.

import { realpathSync } from 'node:fs';
import type { InboxMessageHandler } from '@bakers-build/conductor/contract';
import { homeBbDir } from '@bakers-build/core';
import { servicesToShare, shareAll } from './claim-share.js';
import type { ClaimedDiscovery, ClaimedService } from './claims.js';
import { discoverClaimedServices } from './claims.js';
import {
  assertNoMachinePorts,
  bringUpTunnel,
  loadPortsTransport,
  type OperationContext,
  type PortsTransport,
  readMachineTunnelRecords,
  type TunnelDesiredRecord,
  withProblems,
} from './core.js';
import { nodeDeps, nodeHttpProbe, nodeTunnelOpsDeps } from './deps-node.js';
import { serviceRules } from './service-config.js';
import { tunnelMarkdown } from './tunnel-result.js';

/** The I/O the handler needs, injected so a test drives it with fixtures.
 *  `loadTransport` is the SAME shared loader the CLI uses (`config.ts`'s
 *  `loadPortsTransport`) — one code path for both, so settings validation
 *  cannot be bypassed by going through the inbox instead of the CLI. A
 *  missing/invalid/unresolvable transport resolves to `null`: the message
 *  answers a stable "no ports configuration" line rather than throwing a
 *  raw stack trace into the ticket's addon card. */
export interface TunnelHandlerDeps {
  discover(
    worktree: string,
    ticket: string,
    zone: string,
  ): Promise<ClaimedDiscovery>;
  readRecords(worktree: string): Promise<readonly TunnelDesiredRecord[]>;
  bringUp(
    service: ClaimedService,
    ctx: OperationContext,
  ): Promise<{ ok: boolean; message: string }>;
  /** Same shared loader the CLI uses, surfaced with its own redacted
   *  diagnostic on failure — BB-681 review I5: a missing config and an
   *  unresolvable/invalid transport package are different problems and must
   *  not collapse onto one generic "no configuration" line here while the
   *  CLI reports the real one. */
  loadTransport(): Promise<
    | { readonly ok: true; readonly transport: PortsTransport }
    | { readonly ok: false; readonly message: string }
  >;
  home(): string;
}

/** The worktree as the CLI sees it (`process.cwd()` is already real): DDEV
 *  labels containers with the real path and discovery matches it exactly, so a
 *  symlinked path from the server would find nothing (BB-693). */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function tunnelHandlers(
  deps: TunnelHandlerDeps,
): Record<string, InboxMessageHandler> {
  return {
    tunnel: async (request) => {
      const loaded = await deps.loadTransport();
      if (!loaded.ok) {
        return { markdown: loaded.message };
      }
      const transport = loaded.transport;
      const ticket = request.ticket.identifier;
      const worktree = canonicalPath(request.worktreePath);
      const discovery = await deps.discover(
        worktree,
        ticket,
        transport.zone ?? '',
      );
      const ctx: OperationContext = {
        worktree,
        ticket,
        home: deps.home(),
        transport,
        signal: request.signal,
      };
      const outcomes = await shareAll(servicesToShare(discovery), (s) =>
        deps.bringUp(s, ctx),
      );
      const failures = outcomes
        .filter(({ result }) => !result.ok)
        .map(({ service, result }) => ({ service, message: result.message }));
      const after = await deps.readRecords(worktree);
      return { markdown: tunnelMarkdown(discovery, after, failures) };
    },
  };
}

/** The live handlers for the conductor's effective ports entry `with`
 *  (`options`, machine entry wins) — the conductor passes it per dispatch. */
export function handlersFor(options: unknown) {
  return tunnelHandlers({
    discover: (worktree, ticket, zone) =>
      discoverClaimedServices(worktree, nodeDeps, {
        ticket,
        zone,
        probe: nodeHttpProbe,
        rules: serviceRules(options),
      }),
    readRecords: (worktree) =>
      readMachineTunnelRecords(worktree, homeBbDir(), nodeTunnelOpsDeps),
    bringUp: (service, ctx) =>
      bringUpTunnel(service.rules[0]!, ctx, nodeTunnelOpsDeps),
    loadTransport: async () => {
      // The conductor hands the merged `with`; a bad setting answers here
      // instead of a silently empty claim list.
      const [problem] = withProblems(options);
      if (problem) return { ok: false, message: problem };
      try {
        await assertNoMachinePorts();
        const transport = await loadPortsTransport(options, homeBbDir());
        return { ok: true, transport };
      } catch (err) {
        // The loader already produces a bounded, redacted diagnostic (missing
        // entry, unresolvable package, rejected settings) — the SAME message
        // the CLI prints, never a raw stack trace into the ticket's addon card.
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    home: () => homeBbDir(),
  });
}
