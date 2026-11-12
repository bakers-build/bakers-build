// The ports addon's own settings: which host processes are tunnelled.
// `services` names a key and a command-line substring per service; the port is
// always read from the running process. `all_node` (opt-in) claims every
// remaining Node listener. Storybook is a shipped default entry, so every
// process-based service follows one rule. `claimers` names claimer packages
// (loaded by `config.ts`'s `loadClaimers`), run in order after the services.

/** A DNS-safe service key (one hostname label). */
export const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export interface ServiceRule {
  readonly key: string;
  readonly match: string;
}

export interface ServiceRules {
  readonly entries: readonly ServiceRule[];
  readonly allNode: boolean;
}

export const DEFAULT_STORYBOOK: ServiceRule = {
  key: 'storybook',
  match: 'storybook',
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The one rule options.schema.json cannot express: two `services` entries
 * with the same key. Returns `services[i].key duplicates '<key>'`, or
 * undefined. Types, unknown keys and the label pattern are the schema's.
 */
export function duplicateServiceKey(value: unknown): string | undefined {
  const services = isObject(value) ? value.services : undefined;
  if (!Array.isArray(services)) return undefined;
  const seen = new Set<unknown>();
  for (const [i, entry] of services.entries()) {
    const key = isObject(entry) ? entry.key : undefined;
    if (seen.has(key)) return `services[${i}].key duplicates '${key}'`;
    seen.add(key);
  }
  return undefined;
}

/**
 * The ports addon in both scopes: the machine wins. `services` merge per key
 * (machine entries first); every other key is taken whole from the machine
 * when it sets it, else from the project.
 */
export function mergeWith(project: unknown, machine: unknown): unknown {
  if (!isObject(machine)) return machine === undefined ? project : machine;
  if (!isObject(project)) return machine;
  const merged: Record<string, unknown> = { ...project, ...machine };
  const m = Array.isArray(machine.services) ? machine.services : undefined;
  const p = Array.isArray(project.services) ? project.services : undefined;
  if (m && p) {
    const taken = new Set(m.map((e: { key?: unknown }) => e?.key));
    merged.services = [
      ...m,
      ...p.filter((e: { key?: unknown }) => !taken.has(e?.key)),
    ];
  }
  return merged;
}

/** The effective rules for a (checked) `with`: its services, then the
 *  default `storybook` unless an entry defines that key. */
export function serviceRules(settings: unknown): ServiceRules {
  const s = isObject(settings) ? settings : {};
  const entries = Array.isArray(s.services)
    ? (s.services as ServiceRule[])
    : [];
  return {
    entries: entries.some((e) => e.key === DEFAULT_STORYBOOK.key)
      ? entries
      : [...entries, DEFAULT_STORYBOOK],
    allNode: s.all_node === true,
  };
}
