// BB-224 (Finding 6): the CONDUCTOR-SURFACE plugin contract — the four
// `*Plugin` interfaces, the runtime deps handed to a factory, the agent
// candidate/resolution shapes, and the slot selectors. Moved out of
// `@bakers-build/core` (which is now surface-agnostic) into `@bakers-build/conductor`, the
// package that OWNS the conductor surface. Addons import it from
// `@bakers-build/conductor/contract` (runtime-light: no engine, no commander).
import type { AgentRoutes, ConductorLogger } from '@bakers-build/core';
import type { DropSHPlugin } from 'dropsh/plugin';
import type { ConductorFileConfig } from '../types.js';
import type { BbAgent } from './agent.js';
import type { SecurityMode, SecurityReport } from './agent-args.js';
import type { BbExecutor } from './executor.js';
import type { BbRemote, Ticket } from './remote.js';
import type { BbWorkspace } from './workspace.js';

/** Runtime dependencies handed to a plugin factory at selection time. */
export interface ExecutorDeps {
  /** The in-scope conductor logger — the executor logs hook failures through it. */
  logger: ConductorLogger;
}

export interface RemotePlugin extends DropSHPlugin {
  readonly kind: 'remote';
  readonly id: string;
  readonly requiredModules: string[];
  createRemote(config: ConductorFileConfig): Promise<BbRemote>;
}

export interface ExecutorPlugin extends DropSHPlugin {
  readonly kind: 'executor';
  readonly id: string;
  readonly requiredModules: string[];
  createExecutor(
    config: ConductorFileConfig,
    deps: ExecutorDeps,
  ): Promise<BbExecutor>;
}

export interface WorkspacePlugin extends DropSHPlugin {
  readonly kind: 'workspace';
  readonly id: string;
  readonly requiredModules: string[];
  /**
   * BB-234: `deps` is **optional** so every existing workspace plugin
   * (`addon-workspace-git`, `addon-fake`) keeps compiling untouched — a
   * workspace that logs nothing simply ignores it. It reuses {@link ExecutorDeps}
   * rather than minting a `WorkspaceDeps` alias: that interface is already the
   * contract's name for "runtime deps handed to a plugin factory", and a second
   * identical shape would be two names for one thing.
   */
  createWorkspace(
    config: ConductorFileConfig,
    deps?: ExecutorDeps,
  ): Promise<BbWorkspace>;
}

export interface AgentPlugin extends DropSHPlugin {
  readonly kind: 'agent';
  readonly id: string;
  readonly requiredModules: string[];
  /** The effective run permissions and their source layers (`bakers agents`). */
  readonly permissions?: SecurityReport;
  createAgent(config: ConductorFileConfig): Promise<BbAgent>;
}

/** Resolves the remote from its named config slot. */
export async function selectRemote(
  config: ConductorFileConfig,
): Promise<BbRemote> {
  return config.remote.createRemote(config);
}

/** Resolves the executor from its named config slot, injecting the logger. */
export async function selectExecutor(
  config: ConductorFileConfig,
  logger: ConductorLogger,
): Promise<BbExecutor> {
  return config.executor.createExecutor(config, { logger });
}

/**
 * Resolves the workspace from its named config slot, injecting the logger when
 * the caller has one — mirroring {@link selectExecutor}. Without it the herdr
 * workspace's best-effort open-layout warn would land on a noop logger
 * (BB-234).
 */
export async function selectWorkspace(
  config: ConductorFileConfig,
  logger?: ConductorLogger,
): Promise<BbWorkspace> {
  return config.workspace.createWorkspace(
    config,
    logger ? { logger } : undefined,
  );
}

/** A config-side agent choice: an agent plugin + an optional static priority over the ticket. */
export interface AgentCandidate {
  alias?: string;
  description?: string;
  model?: string;
  modelVersion?: string;
  agent: AgentPlugin;
  priority?: (ticket: Ticket) => number;
}

/** A constructed candidate: the agent id, its BbAgent, and the config-side priority. */
export interface ResolvedAgent {
  alias?: string;
  description?: string;
  /** The candidate's configured model, when it pins one. Preferred over the
   * transcript-derived model at run close, because an explicit human answer
   * beats a guess; absent when the harness's own local configuration chooses
   * the model, in which case the transcript's raw model id is used instead. */
  model?: string;
  /** The candidate's configured exact model version, when it pins one.
   * Preferred over the transcript-derived version at run close for the same
   * reason as `model`; absent when the transcript's raw model id should be
   * used instead. */
  modelVersion?: string;
  id: string;
  /** The candidate's effective security mode, for the run's `plugins` log entry. */
  security?: SecurityMode;
  agent: BbAgent;
  priority?: (ticket: Ticket) => number;
}

/** A missing `priority` scores strictly below any real number (AC-4). */
const DEFAULT_PRIORITY = Number.NEGATIVE_INFINITY;

/**
 * Pick the agent for a ticket: highest `priority(ticket)` wins; a candidate with
 * no `priority` scores lowest; ties resolve by config array order (stable sort).
 */
export function selectAgent(
  candidates: ResolvedAgent[],
  ticket: Ticket,
): ResolvedAgent {
  const best = candidates
    .map((c, index) => ({
      c,
      index,
      score: c.priority ? c.priority(ticket) : DEFAULT_PRIORITY,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];
  if (!best) {
    throw new Error('selectAgent: no agent candidates configured');
  }
  return best.c;
}

/** Constructs every agent candidate from the normalized effective catalog. */
export async function selectAgents(
  config: ConductorFileConfig,
): Promise<ResolvedAgent[]> {
  const candidates = config.agents;
  return Promise.all(
    candidates.map(async (c) => ({
      id: c.agent.id,
      ...(c.alias !== undefined ? { alias: c.alias } : {}),
      ...(c.description !== undefined ? { description: c.description } : {}),
      ...(c.model !== undefined ? { model: c.model } : {}),
      ...(c.modelVersion !== undefined ? { modelVersion: c.modelVersion } : {}),
      ...(c.agent.security ? { security: c.agent.security.mode.value } : {}),
      agent: await c.agent.createAgent(config),
      ...(c.priority ? { priority: c.priority } : {}),
    })),
  );
}

/** Resolve logical aliases without changing the legacy priority selector. */
export function resolveAgent(
  candidates: ResolvedAgent[],
  ticket: Ticket,
  options: {
    warn?: (message: string) => void;
    selectAgent?: ConductorFileConfig['selectAgent'];
    routes?: AgentRoutes;
    defaultAgent?: string;
  } = {},
): ResolvedAgent {
  if (options.selectAgent) return options.selectAgent(candidates, ticket);
  const labels = ticket.labels.filter((label) => label.startsWith('agent:'));
  const scoped: string[] = [];
  const general: string[] = [];
  for (const label of labels) {
    const [alias, state, extra] = label.slice('agent:'.length).split('@');
    if (!alias || extra !== undefined) continue;
    if (state === ticket.state) scoped.push(alias);
    else if (state === undefined) general.push(alias);
  }
  const warn = options.warn ?? console.warn;
  const routes = options.routes ?? {};
  const direct = (aliases: string[]): ResolvedAgent | undefined => {
    for (const alias of aliases) {
      const candidate = candidates.find((c) => c.alias === alias);
      if (candidate) return candidate;
      if (routes[alias] !== undefined) continue;
      warn(
        `${ticket.identifier}: agent alias '${alias}' is unavailable; trying the next fallback`,
      );
    }
    return undefined;
  };
  const directCandidate = direct(scoped) ?? direct(general);
  if (directCandidate) return directCandidate;

  const resolveRoutes = (names: string[]): ResolvedAgent | undefined => {
    for (const name of names) {
      if (name === 'default') continue;
      const route = routes[name];
      if (route === undefined) continue;
      const alias = route[ticket.state] ?? route['*'];
      if (alias === undefined) {
        warn(
          `${ticket.identifier}: agent route '${name}' has no entry for '${ticket.state}' or '*'; trying the next fallback`,
        );
        continue;
      }
      const candidate = candidates.find((c) => c.alias === alias);
      if (candidate) return candidate;
      warn(
        `${ticket.identifier}: agent route '${name}' resolves to unavailable alias '${alias}'; trying the next fallback`,
      );
    }
    return undefined;
  };
  const routeCandidate = resolveRoutes(scoped) ?? resolveRoutes(general);
  if (routeCandidate) return routeCandidate;

  const defaultRoute = routes.default;
  for (const alias of [defaultRoute?.[ticket.state], defaultRoute?.['*']]) {
    if (alias === undefined) continue;
    const candidate = candidates.find((c) => c.alias === alias);
    if (candidate) return candidate;
    warn(
      `${ticket.identifier}: agent route 'default' resolves to unavailable alias '${alias}'; trying the next fallback`,
    );
  }

  if (options.defaultAgent !== undefined) {
    const candidate = candidates.find((c) => c.alias === options.defaultAgent);
    if (candidate) return candidate;
    warn(
      `${ticket.identifier}: agent alias '${options.defaultAgent}' is unavailable; trying the next fallback`,
    );
  }
  return selectAgent(candidates, ticket);
}
