// The ports addon's agent tools, served by the conductor — the only writer
// of the machine's tunnel routes. Every tool acts on the worktree bound to
// the caller (a run's session, or the operator's cwd), never on an argument,
// and only on services that worktree claims. `bakers ports up/down/status/
// reap` call these same tools through the conductor.

import { existsSync, realpathSync } from 'node:fs';
import type {
  ToolHandler,
  ToolRequest,
} from '@bakers-build/conductor/contract';
import { homeBbDir } from '@bakers-build/core';
import { servicesToShare, shareAll } from './claim-share.js';
import type { ClaimedDiscovery, TunnelRule } from './claims.js';
import { discoverClaimedServices } from './claims.js';
import {
  assertNoMachinePorts,
  bringUpTunnel,
  loadClaimers,
  loadPortsTransport,
  type OperationContext,
  type PortsTransport,
  readMachineTunnelRecords,
  reapTunnels,
  type TunnelDesiredRecord,
  takeDownTunnel,
  withProblems,
} from './core.js';
import { nodeDeps, nodeHttpProbe, nodeTunnelOpsDeps } from './deps-node.js';
import {
  currentBranch,
  liveTunnel,
  resolveTicketIdentifier,
  selectService,
  staleKeys,
} from './index.js';
import { serviceRules } from './service-config.js';
import type { OpResult, ReapLiveness, ReapResult } from './tunnel-ops.js';

export interface PortsToolDeps {
  loadTransport(): Promise<
    | { readonly ok: true; readonly transport: PortsTransport }
    | { readonly ok: false; readonly message: string }
  >;
  discover(
    worktree: string,
    ticket: string,
    zone: string,
  ): Promise<ClaimedDiscovery>;
  readRecords(worktree: string): Promise<readonly TunnelDesiredRecord[]>;
  bringUp(rule: TunnelRule, ctx: OperationContext): Promise<OpResult>;
  takeDown(
    worktree: string,
    key: string | undefined,
    ctx: OperationContext,
  ): Promise<OpResult>;
  reap(
    ctx: Pick<OperationContext, 'home' | 'transport' | 'signal'>,
    isLive: (record: TunnelDesiredRecord) => Promise<ReapLiveness>,
  ): Promise<ReapResult>;
  branch(worktree: string): string | null;
  home(): string;
}

/** Container labels carry the real path; discovery matches it exactly. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function portsTools(deps: PortsToolDeps): Record<string, ToolHandler> {
  const transportOf = async (): Promise<PortsTransport> => {
    const loaded = await deps.loadTransport();
    if (!loaded.ok) throw new Error(loaded.message);
    return loaded.transport;
  };
  const ticketOf = (req: ToolRequest, worktree: string): string => {
    if (req.ticket) return req.ticket.identifier;
    const resolved = resolveTicketIdentifier(undefined, deps.branch(worktree));
    if (!resolved.ok) throw new Error(resolved.message);
    return resolved.identifier;
  };
  const reapAll = (transport: PortsTransport, signal: AbortSignal) =>
    deps.reap({ home: deps.home(), transport, signal }, async (record) => {
      if (!existsSync(record.worktree)) return { live: false };
      try {
        const discovery = await deps.discover(
          record.worktree,
          record.ticket,
          transport.zone ?? '',
        );
        return liveTunnel(record, discovery);
      } catch {
        // Unreadable settings are no evidence the route is gone: keep it.
        return { live: true };
      }
    });

  return {
    ports_up: async (req) => {
      const transport = await transportOf();
      const worktree = canonicalPath(req.worktreePath);
      const ticket = ticketOf(req, worktree);
      const lines: string[] = [];
      // A container IP reused by another project after a container restart
      // would serve that project under a stale route, so every `up` first
      // re-checks every recorded route machine-wide, exactly like `reap`.
      const recheck = await reapAll(transport, req.signal);
      if (
        !recheck.ok ||
        recheck.removedRecords > 0 ||
        (recheck.refreshedRecords ?? 0) > 0
      )
        lines.push(recheck.message);
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
        signal: req.signal,
      };
      const key = req.args.service as string | undefined;
      if (key === undefined) {
        const toShare = servicesToShare(discovery);
        if (toShare.length === 0)
          return { text: 'no eligible service to share' };
        const outcomes = await shareAll(toShare, (claimed) =>
          deps.bringUp(claimed.rules[0]!, ctx),
        );
        for (const { service: claimed, result } of outcomes)
          lines.push(`${claimed.key}: ${result.message}`);
        if (outcomes.some(({ result }) => !result.ok))
          throw new Error(lines.join('\n'));
        return { text: lines.join('\n') };
      }
      const selection = selectService(discovery, key);
      if (!selection.ok) throw new Error(selection.message);
      const claimed = selection.service;
      if (claimed.rules.length === 0)
        throw new Error(
          `${claimed.key} cannot be shared (${claimed.status}${claimed.limitation ? `: ${claimed.limitation}` : ''})`,
        );
      const result = await deps.bringUp(claimed.rules[0]!, ctx);
      lines.push(result.message);
      if (claimed.limitation) lines.push(claimed.limitation);
      if (!result.ok) throw new Error(lines.join('\n'));
      return { text: lines.join('\n') };
    },

    ports_down: async (req) => {
      const transport = await transportOf();
      const worktree = canonicalPath(req.worktreePath);
      const result = await deps.takeDown(
        worktree,
        req.args.service as string | undefined,
        {
          worktree,
          ticket: '',
          home: deps.home(),
          transport,
          signal: req.signal,
        },
      );
      if (!result.ok) throw new Error(result.message);
      return { text: result.message };
    },

    ports_status: async (req) => {
      const worktree = canonicalPath(req.worktreePath);
      const records = await deps.readRecords(worktree);
      let stale = new Set<string>();
      const [first] = records;
      if (first) {
        try {
          stale = staleKeys(
            records,
            await deps.discover(worktree, first.ticket, ''),
          );
        } catch {
          // Without discovery nothing is known to be stale.
        }
      }
      const rows = records.map((r) => ({
        service: r.key,
        status: r.applied,
        local: r.service,
        ...(r.url || r.hostname
          ? { url: r.url ?? `https://${r.hostname}` }
          : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(stale.has(r.key) ? { stale: true } : {}),
      }));
      return { text: JSON.stringify(rows) };
    },

    ports_reap: async (req) => {
      const result = await reapAll(await transportOf(), req.signal);
      if (!result.ok) throw new Error(result.message);
      return { text: result.message };
    },
  };
}

/** The live tools for the conductor's effective ports entry `with`. */
export function toolsFor(options: unknown): Record<string, ToolHandler> {
  return portsTools({
    loadTransport: async () => {
      const [problem] = withProblems(options);
      if (problem) return { ok: false, message: problem };
      try {
        await assertNoMachinePorts();
        return {
          ok: true,
          transport: await loadPortsTransport(options, homeBbDir()),
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    discover: async (worktree, ticket, zone) =>
      discoverClaimedServices(worktree, nodeDeps, {
        ticket,
        zone,
        probe: nodeHttpProbe,
        rules: serviceRules(options),
        claimers: await loadClaimers(options, homeBbDir()),
      }),
    readRecords: (worktree) =>
      readMachineTunnelRecords(worktree, homeBbDir(), nodeTunnelOpsDeps),
    bringUp: (rule, ctx) => bringUpTunnel(rule, ctx, nodeTunnelOpsDeps),
    takeDown: (worktree, key, ctx) =>
      takeDownTunnel(worktree, key, ctx, nodeTunnelOpsDeps),
    reap: (ctx, isLive) => reapTunnels(ctx, isLive, nodeTunnelOpsDeps),
    branch: currentBranch,
    home: () => homeBbDir(),
  });
}
