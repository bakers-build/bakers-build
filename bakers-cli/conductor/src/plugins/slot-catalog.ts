import type { AgentRoutes } from '@bakers-build/core';
import type { Ticket } from './remote.js';

export type SlotName = 'agent' | 'runtime' | 'workspace' | 'executor';

export interface SlotCatalog<P> {
  slot: SlotName;
  entries: Record<string, P>;
  default: string;
  /** Named routes (`name -> state|'*' -> alias`); `default` is the catalog-wide route. */
  routes: AgentRoutes;
  /** Machine function replacing the whole order. */
  select?: (candidates: string[], ticket: Ticket) => string;
  projectDefault?: string;
  preset?: string;
  fallback?: string;
}

export type SlotChoice = {
  alias: string;
  reason:
    | 'label'
    | 'function'
    | 'route'
    | 'default-route'
    | 'project'
    | 'preset'
    | 'fallback';
};

/** Order, first hit wins: label, named route, default route, project, preset, fallback. */
export function selectSlot<P>(
  c: SlotCatalog<P>,
  t: Ticket,
  o: {
    labelAllowed?: (alias: string) => boolean;
    warn?: (m: string) => void;
  } = {},
): SlotChoice {
  const aliases = Object.keys(c.entries);
  const known = (alias: string, where: string): string => {
    if (!(alias in c.entries)) {
      throw new Error(
        `${t.identifier}: ${c.slot} ${where} names unknown alias '${alias}'`,
      );
    }
    return alias;
  };

  if (c.select) {
    let alias: string;
    try {
      alias = c.select(aliases, t);
    } catch (e) {
      throw new Error(
        `${t.identifier}: ${c.slot} select failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return {
      alias: known(alias, `select returned '${alias}'; it`),
      reason: 'function',
    };
  }

  const prefix = `${c.slot}:`;
  const scoped: string[] = [];
  const general: string[] = [];
  for (const label of t.labels.filter((l) => l.startsWith(prefix))) {
    const [alias, state, extra] = label.slice(prefix.length).split('@');
    if (!alias || extra !== undefined) {
      throw new Error(`${t.identifier}: malformed ${c.slot} label '${label}'`);
    }
    if (state === t.state) scoped.push(alias);
    else if (state === undefined) general.push(alias);
  }
  const warn = o.warn ?? console.warn;
  for (const name of [...scoped, ...general]) {
    if (name in c.entries) {
      if (o.labelAllowed && !o.labelAllowed(name)) {
        warn(
          `${t.identifier}: ${c.slot} label '${name}' is not allowed; ignored`,
        );
        continue;
      }
      return { alias: name, reason: 'label' };
    }
    const route = name !== 'default' ? c.routes[name] : undefined;
    if (!route)
      throw new Error(
        `${t.identifier}: ${c.slot} label names unknown alias '${name}'`,
      );
    const alias = route[t.state] ?? route['*'];
    if (alias === undefined) {
      warn(
        `${t.identifier}: ${c.slot} route '${name}' has no entry for '${t.state}' or '*'; ignored`,
      );
      continue;
    }
    return { alias: known(alias, `route '${name}'`), reason: 'route' };
  }

  const dflt = c.routes.default?.[t.state] ?? c.routes.default?.['*'];
  if (dflt !== undefined)
    return { alias: known(dflt, "route 'default'"), reason: 'default-route' };
  if (c.projectDefault !== undefined)
    return { alias: c.projectDefault, reason: 'project' };
  if (c.preset !== undefined) return { alias: c.preset, reason: 'preset' };
  return { alias: c.fallback ?? c.default, reason: 'fallback' };
}

/** One instance promise per `slot/alias`, so preflights run once per entry. */
export class SlotResolver {
  private readonly cache = new Map<string, Promise<unknown>>();

  instance<I>(
    slot: SlotName,
    alias: string,
    build: () => Promise<I>,
  ): Promise<I> {
    const key = `${slot}/${alias}`;
    let p = this.cache.get(key);
    if (!p) {
      p = build();
      this.cache.set(key, p);
    }
    return p as Promise<I>;
  }
}
