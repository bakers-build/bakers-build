// The ports addon's own settings: which host processes are tunnelled.
// `services` names a key and a command-line substring per service; the port is
// always read from the running process. `all_node` (opt-in) claims every
// remaining Node listener. Storybook is a shipped default entry, so every
// process-based service follows one rule.

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

export interface WithFinding {
  /** Relative to the entry's `with`: `services[1].key`, `all_node`, `foo`. */
  readonly key: string;
  readonly message: string;
}

export const DEFAULT_STORYBOOK: ServiceRule = {
  key: 'storybook',
  match: 'storybook',
};

const WITH_KEYS = new Set(['transport', 'services', 'all_node']);
const ENTRY_KEYS = new Set(['key', 'match']);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every problem in a ports entry's `with`; `[]` when it is valid or absent. */
export function checkWith(value: unknown): WithFinding[] {
  if (value === undefined) return [];
  if (!isObject(value)) return [{ key: '', message: 'must be an object' }];
  const out: WithFinding[] = [];
  for (const k of Object.keys(value))
    if (!WITH_KEYS.has(k))
      out.push({
        key: k,
        message: 'is not a ports setting (transport, services, all_node)',
      });
  const { transport, services, all_node } = value;
  if (transport !== undefined) {
    if (!isObject(transport))
      out.push({ key: 'transport', message: 'must be an object' });
    else if (typeof transport.use !== 'string' || transport.use === '')
      out.push({
        key: 'transport.use',
        message: 'must name a transport package',
      });
  }
  if (all_node !== undefined && typeof all_node !== 'boolean')
    out.push({ key: 'all_node', message: 'must be true or false' });
  if (services !== undefined) {
    if (!Array.isArray(services))
      out.push({ key: 'services', message: 'must be an array' });
    else {
      const seen = new Set<string>();
      services.forEach((entry: unknown, i) => {
        const at = `services[${i}]`;
        if (!isObject(entry)) {
          out.push({ key: at, message: 'must be { key, match }' });
          return;
        }
        for (const k of Object.keys(entry))
          if (!ENTRY_KEYS.has(k))
            out.push({
              key: `${at}.${k}`,
              message: 'is not a service field (key, match)',
            });
        if (typeof entry.key !== 'string' || !LABEL_RE.test(entry.key))
          out.push({
            key: `${at}.key`,
            message: 'must be a DNS-safe label (a-z, 0-9, -)',
          });
        else if (seen.has(entry.key))
          out.push({ key: `${at}.key`, message: `duplicates '${entry.key}'` });
        else seen.add(entry.key);
        if (typeof entry.match !== 'string' || entry.match === '')
          out.push({
            key: `${at}.match`,
            message: 'must be a non-empty string',
          });
      });
    }
  }
  return out;
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
