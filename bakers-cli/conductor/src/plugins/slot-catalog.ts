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
  /** The ticket label that chose the entry, for reason `label`. */
  label?: string;
};

/** Order, first hit wins: label (alias or named route), machine route for the state, default route (`*`), project, preset, fallback. */
export function selectSlot<P>(
  c: SlotCatalog<P>,
  t: Ticket,
  o: {
    labelAllowed?: (alias: string) => boolean;
    /** Why a refused label's entry is refused, ending the warning after "which". */
    denied?: string;
    warn?: (m: string) => void;
  } = {},
): SlotChoice {
  const aliases = Object.keys(c.entries);
  const known = (alias: string, where: string): string => {
    if (!Object.hasOwn(c.entries, alias)) {
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
  const scoped: Array<[string, string]> = [];
  const general: Array<[string, string]> = [];
  for (const label of t.labels.filter((l) => l.startsWith(prefix))) {
    const [alias, state, extra] = label.slice(prefix.length).split('@');
    if (!alias || extra !== undefined) {
      throw new Error(`${t.identifier}: malformed ${c.slot} label '${label}'`);
    }
    if (state === t.state) scoped.push([alias, label]);
    else if (state === undefined) general.push([alias, label]);
  }
  const warn = o.warn ?? console.warn;
  for (const [name, label] of [...scoped, ...general]) {
    let alias = name;
    if (!Object.hasOwn(c.entries, name)) {
      const route =
        name !== 'default' && Object.hasOwn(c.routes, name)
          ? c.routes[name]
          : undefined;
      if (!route)
        throw new Error(
          `${t.identifier}: ${c.slot} label names unknown alias '${name}'`,
        );
      const viaRoute = route[t.state] ?? route['*'];
      if (viaRoute === undefined) {
        warn(
          `${t.identifier}: ${c.slot} route '${name}' has no entry for '${t.state}' or '*'; ignored`,
        );
        continue;
      }
      alias = known(viaRoute, `route '${name}'`);
    }
    if (o.labelAllowed && !o.labelAllowed(alias)) {
      warn(
        o.denied
          ? `${t.identifier}: ${c.slot} label '${name}' chooses ${c.slot} '${alias}', which ${o.denied}`
          : `${t.identifier}: ${c.slot} label '${name}' is not allowed; ignored`,
      );
      continue;
    }
    return { alias, reason: 'label', label };
  }

  const machine = c.routes.default?.[t.state];
  if (machine !== undefined)
    return { alias: known(machine, "route 'default'"), reason: 'route' };
  const dflt = c.routes.default?.['*'];
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
      // A failed build (e.g. a daemon not up yet) is retried by the next run.
      p.catch(() => this.cache.delete(key));
    }
    return p as Promise<I>;
  }
}
