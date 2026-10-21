// BB-403: resolve entity NAMES into the relationship that references them, so
// a skill writes `--label_names work:code` or `--environment_names staging`
// instead of searching the collection, pulling a UUID out with jq, and
// hand-building the linkage.
//
// Two hooks, deliberately split by what they may do:
//   extendOperationSchema — OFFLINE. It makes each synthetic field a settable
//     field parameter. dropsh disk-caches the extended schema (keyed on the
//     loaded hook plugins), so anything fetched here would go stale; that is why
//     the synthetic fields carry no enum of names.
//   alterRequest — the resolution, on the LIVE write only. `--dry-run` returns
//     before the client, so a dry-run shows the synthetic field unresolved and a
//     typo surfaces on the live call — atomically: a throw here becomes a
//     PluginError (exit 6) and nothing is sent.
//
// WHERE THIS LIVES. Its own package, `@bakers-build/addon-name-refs`, carried as a
// child of `@bakers-build/addon-essentials` exactly as `@bakers-build/addon-workspace` is
// — so no config names it and the single non-auth `plugins[]` entry every
// committed config already has is unchanged. It contributes no preset
// accumulator, so it is a plain sibling edge in `PERMITTED_SIBLINGS`.
//
// Adding a target is one RESOLVERS entry. The one thing that differs between
// them is whether a name is unique on its own: `bb_term` names are, so a name
// identifies a term outright. `bb_environment` names are unique only WITHIN A
// PROJECT (BbEnvironmentUniquePerProject), so the same name legitimately
// exists several times and picking one would be luck rather than resolution —
// hence `scopeField`, and the narrowing it drives.

import type { DropSHPlugin, HttpRequest, RequestContext } from 'dropsh/plugin';

interface NameRef {
  /** The synthetic attribute; one flag, comma-separated (a repeated attribute throws). */
  field: string;
  /** How the target is named in an error message. */
  noun: string;
  /** The relationship on the written entity that receives the resolved ids. */
  relationship: string;
  /** JSON:API resource type of the target. */
  type: string;
  /** JSON:API collection path of the target. */
  path: string;
  title: string;
  /**
   * Set when a name is unique only within some parent. It names a field on the
   * TARGET to compare against — `project_id` for environments, `workspace_id`
   * for labels. The matching value on the payload side is reached via
   * `scopeChain` (a dotted path) or, when the payload carries the same
   * relationship directly, by reading it off the payload.
   */
  scopeField?: string;
  /**
   * Dotted path on the PAYLOAD to the same uuid the target's `scopeField`
   * carries. The first segment names a relationship on the payload (CREATE)
   * or on the entity being updated (UPDATE); each subsequent segment names a
   * relationship to walk through `included[*]`. The chain reaches the final
   * uuid via a single fetch with `?include=<remaining-segments>`.
   *
   * For environments the chain is implicit: `project_id` lives on the payload
   * already, so no chain is declared. For labels the chain is
   * `project_id.group_id.workspace_id` — the payload carries `project_id`,
   * and the resolver fetches the project with `?include=group_id.workspace_id`
   * to reach the workspace uuid in one round trip.
   */
  scopeChain?: string;
}

const RESOLVERS: NameRef[] = [
  {
    field: 'label_names',
    noun: 'label',
    relationship: 'labels',
    type: 'bb_term--bb_labels',
    path: 'bb_term/bb_labels',
    title:
      'Label names (comma-separated bb_labels names; ' +
      'unique only within workspace_id — resolved to labels on the live write)',
    // BB-531: bb_term names are unique within (workspace_id, vid), so the
    // same name legitimately exists in several workspaces and a bare index
    // would silently pick one. The workspace is reached from the payload via
    // the chain project_id → group_id → workspace_id.
    scopeField: 'workspace_id',
    scopeChain: 'project_id.group_id.workspace_id',
  },
  {
    field: 'environment_names',
    noun: 'environment',
    relationship: 'environments',
    type: 'bb_environment--bb_environment',
    path: 'bb_environment/bb_environment',
    title:
      'Environment names (comma-separated; unique per project, so an ' +
      'ambiguous name is narrowed by the project_id of the write — ' +
      'resolved to environments on the live write)',
    scopeField: 'project_id',
  },
];

/**
 * page[limit] bounds the QUERY, not the row count — links.next is the only end
 * signal. Asking for more than Drupal's `OffsetPage::SIZE_MAX` is not an error,
 * it is silently clamped to it, so requesting 200 bought nothing and made the
 * ceiling below misreport itself by 4x. 50 is the number the server will
 * actually serve.
 */
const PAGE_LIMIT = 50;
const MAX_PAGES = 10;
/** Rows this resolver will walk before it refuses to resolve at all. */
const MAX_ROWS = PAGE_LIMIT * MAX_PAGES;
/**
 * How many known names an error may list. `bb_labels` is small; a future
 * target need not be, and an error nobody can read is an error nobody reads.
 */
const NAME_LIST_CAP = 20;

type Json = Record<string, unknown>;

/** One row of a target collection, keyed by name in the index. */
interface Candidate {
  id: string;
  scopeId?: string | undefined;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(node: unknown, ...path: string[]): unknown {
  let cursor: unknown = node;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

/** The id a relationship points at, for the single-valued relationships used as scopes. */
function relationshipId(node: unknown, field: string): string | undefined {
  const id = at(node, 'relationships', field, 'data', 'id');
  return typeof id === 'string' ? id : undefined;
}

/**
 * The type a relationship points at. Needed to look the related entity up in
 * `included[*]`, which is keyed by (type, id) in JSON:API.
 */
function relationshipType(node: unknown, field: string): string | undefined {
  const type = at(node, 'relationships', field, 'data', 'type');
  return typeof type === 'string' ? type : undefined;
}

/** `'bb_project--bb_project'` → `'bb_project/bb_project'`. */
function typeToPath(type: string): string {
  return type.replace('--', '/');
}

/** Find a related entity in `included[*]` by (type, id). */
function findInIncluded(
  doc: unknown,
  type: string | undefined,
  id: string,
): unknown {
  if (type === undefined) return undefined;
  const included = at(doc, 'included');
  if (!Array.isArray(included)) return undefined;
  return included.find(
    (entry) => isRecord(entry) && entry.type === type && entry.id === id,
  );
}

/**
 * Walk a chain of relationships through `included[*]`, starting from
 * `doc.data`. Each segment names a relationship on the current node whose
 * target entity is the next node. The final segment's `data.id` is returned.
 *
 * The first segment is allowed to be absent on the starting node: an UPDATE
 * that fetches its own entity may receive a document whose `data` is already
 * the first entity in the chain (the project, not the ticket that points at
 * it), and the walk must skip the first hop rather than fail.
 */
function walkChain(
  doc: unknown,
  segments: readonly string[],
): string | undefined {
  let node: unknown = at(doc, 'data');
  if (!isRecord(node)) return undefined;
  let skippedFirst = false;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === undefined) return undefined;
    const nextId = relationshipId(node, segment);
    if (nextId === undefined) {
      if (i === 0 && !skippedFirst) {
        skippedFirst = true;
        continue;
      }
      return undefined;
    }
    if (i === segments.length - 1) return nextId;
    const nextType = relationshipType(node, segment);
    const nextNode = findInIncluded(doc, nextType, nextId);
    if (!isRecord(nextNode)) return undefined;
    node = nextNode;
  }
  return undefined;
}

/**
 * Resolve the chain scope uuid. For a CREATE the first segment is read off
 * the payload and the rest is fetched via `?include=<remaining>`; for an
 * UPDATE the entity itself is fetched with the full chain as include, so a
 * single round trip resolves both the payload-side scope and the chain.
 *
 * Returns `undefined` when the chain cannot be followed — a missing project,
 * a broken chain, or no `project_id` anywhere the resolver can read. The
 * caller turns that into a hard error rather than guessing a uuid.
 */
async function resolveChainScope(
  req: HttpRequest,
  ctx: RequestContext,
  ref: NameRef,
  data: unknown,
): Promise<string | undefined> {
  if (ref.scopeChain === undefined) return undefined;
  const segments = ref.scopeChain.split('.');
  const prefix = normalisePrefix(ctx.jsonapiPrefix);
  const base = ctx.baseUrl.replace(/\/+$/, '');
  if (ctx.operation === 'create') {
    const firstSegment = segments[0];
    if (firstSegment === undefined) return undefined;
    const firstId = relationshipId(data, firstSegment);
    if (firstId === undefined) return undefined;
    const firstType = relationshipType(data, firstSegment);
    if (firstType === undefined) return undefined;
    const firstPath = typeToPath(firstType);
    const remaining = segments.slice(1).join('.');
    const url =
      `${base}${prefix}/${firstPath}/${firstId}` +
      (remaining === '' ? '' : `?include=${remaining}`);
    const doc = await fetchDoc(ctx, url, `the ${firstPath} entity`);
    return walkChain(doc, segments.slice(1));
  }
  const includeParam = segments.join('.');
  const separator = req.url.includes('?') ? '&' : '?';
  const url = `${req.url}${separator}include=${includeParam}`;
  const doc = await fetchDoc(ctx, url, 'the entity being updated');
  return walkChain(doc, segments);
}

/**
 * Does this operation schema declare this resolver's relationship over its
 * target type? Only the multi-valued (`items`) shape is recognised: both
 * targets are unlimited-cardinality, and the merge below writes an array, so
 * matching a single-valued relationship here would produce an invalid payload.
 */
function declares(schema: unknown, ref: NameRef): boolean {
  const targets = at(
    schema,
    'properties',
    'data',
    'properties',
    'relationships',
    'properties',
    ref.relationship,
    'properties',
    'data',
    'items',
    'properties',
    'type',
    'enum',
  );
  return Array.isArray(targets) && targets.includes(ref.type);
}

/** `/jsonapi`, however the config spelled it — with, without, or with a trailing slash. */
function normalisePrefix(raw: string | undefined): string {
  const trimmed = (raw ?? '/jsonapi').replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed === '' ? '' : `/${trimmed}`;
}

/**
 * GET one JSON:API document, or fail by name.
 *
 * This plugin issues its own reads through `ctx.http` / `ctx.auth`, which is the
 * only seam the plugin API offers — and it is NOT the seam dropsh's JSON:API
 * client uses. That client catches a 401 and calls `auth.renew()` once
 * (`client.js:44-47`); nothing here can, because `AuthAdapter.apply` exposes no
 * renewal. So an expired token cannot be refreshed transparently mid-write: it
 * arrives here as a plain non-2xx, and the least this can do is say so instead
 * of handing an HTML error page to `JSON.parse`.
 */
async function fetchDoc(
  ctx: RequestContext,
  url: string,
  what: string,
): Promise<unknown> {
  const res = await ctx.http.send(
    await ctx.auth.apply({
      method: 'GET',
      url,
      headers: { Accept: 'application/vnd.api+json' },
    }),
  );
  if (res.status < 200 || res.status >= 300) {
    const expiry =
      res.status === 401 || res.status === 403
        ? ' The access token may have expired: this plugin performs its own reads ' +
          'and, unlike dropsh’s JSON:API client, cannot renew one, so an expired ' +
          'token surfaces here instead of being refreshed. Re-authenticate and retry.'
        : '';
    throw new Error(
      `could not read ${what}: HTTP ${res.status} from ${url}.${expiry}`,
    );
  }
  try {
    return JSON.parse(res.body);
  } catch (cause) {
    throw new Error(
      `could not read ${what}: ${url} answered ${res.status} but not JSON (${String(cause)})`,
    );
  }
}

/**
 * The whole collection as name → candidates. One round trip regardless of how
 * many names were given, and it yields the known-names list the error needs.
 */
async function fetchIndex(
  ctx: RequestContext,
  ref: NameRef,
): Promise<Map<string, Candidate[]>> {
  const prefix = normalisePrefix(ctx.jsonapiPrefix);
  const fields =
    ref.scopeField === undefined ? 'name' : `name,${ref.scopeField}`;
  let url =
    `${ctx.baseUrl.replace(/\/+$/, '')}${prefix}/${ref.path}` +
    `?fields[${ref.type}]=${fields}&sort=name&page[limit]=${PAGE_LIMIT}`;
  const byName = new Map<string, Candidate[]>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const doc = await fetchDoc(ctx, url, `the ${ref.path} vocabulary`);
    const rows = at(doc, 'data');
    for (const row of Array.isArray(rows) ? rows : []) {
      const name = at(row, 'attributes', 'name');
      const id = isRecord(row) ? row.id : undefined;
      if (typeof name !== 'string' || typeof id !== 'string') continue;
      const candidate: Candidate = {
        id,
        scopeId:
          ref.scopeField === undefined
            ? undefined
            : relationshipId(row, ref.scopeField),
      };
      const bucket = byName.get(name);
      if (bucket === undefined) byName.set(name, [candidate]);
      else if (!bucket.some((c) => c.id === id)) bucket.push(candidate);
    }
    const next = at(doc, 'links', 'next', 'href');
    if (typeof next !== 'string') return byName;
    url = next;
  }
  throw new Error(
    `the ${ref.path} collection did not end within ${MAX_PAGES} pages of ` +
      `${PAGE_LIMIT} (Drupal clamps page[limit] to OffsetPage::SIZE_MAX = ` +
      `${PAGE_LIMIT}, so the ceiling is ${MAX_ROWS} rows); refusing to resolve ` +
      `against a truncated list`,
  );
}

/** Read the scope off the entity being updated — the fallback when the PATCH omits it. */
async function fetchScope(
  req: HttpRequest,
  ctx: RequestContext,
  scopeField: string,
): Promise<string | undefined> {
  const doc = await fetchDoc(ctx, req.url, `the entity being updated`);
  return relationshipId(at(doc, 'data'), scopeField);
}

/** The known-names list an error may print — bounded, and honest about the total. */
function knownNames(byName: Map<string, Candidate[]>): string {
  const names = [...byName.keys()];
  if (names.length === 0) return '(none)';
  if (names.length <= NAME_LIST_CAP) return names.join(', ');
  return `${names.slice(0, NAME_LIST_CAP).join(', ')}, … (${names.length} in total)`;
}

function describe(candidates: Candidate[]): string {
  return candidates
    .map((c) => (c.scopeId === undefined ? c.id : `${c.id} (${c.scopeId})`))
    .join(', ');
}

export function nameRefsPlugin(): DropSHPlugin {
  // Per-instance, not module-level: one CLI invocation performs one write, so
  // these guard against a second lookup, and they keep tests isolated.
  const indexes = new Map<string, Promise<Map<string, Candidate[]>>>();
  const scopes = new Map<string, Promise<string | undefined>>();
  /**
   * Chain-scope resolutions, keyed by the resolver field (not by `scopeField`):
   * several resolvers could share a scopeField but differ in their chain, and
   * a chain resolution is a round trip we want to pay once per write.
   */
  const chainScopes = new Map<string, Promise<string | undefined>>();
  /**
   * Which synthetic fields each bundle was offered, recorded as
   * `extendOperationSchema` runs. `alterRequest` gets no schema — `RequestContext`
   * carries only the entity type, the bundle and the operation — so this is the
   * only way it can know that a `label_names` reaching a `bb_comment` write is
   * not a field that bundle has.
   *
   * ABSENCE PROVES NOTHING. dropsh disk-caches the extended schema and skips the
   * hook on a cache hit, so an empty record is the normal case for a repeat
   * write, not evidence that the bundle declares nothing. The check below is
   * therefore a NEGATIVE one only: refuse when this instance has positive
   * evidence to the contrary, never merely because it has none.
   */
  const offered = new Map<string, Set<string>>();
  const bundleKey = (entityType?: string, bundle?: string) =>
    `${entityType ?? ''}/${bundle ?? ''}`;

  return {
    id: 'bakers-name-refs',
    requiredModules: [],

    async extendOperationSchema(entityType, bundle, _operation, schema) {
      if (!isRecord(schema)) return schema;
      const matching = RESOLVERS.filter((ref) => declares(schema, ref));
      // Recorded even when nothing matched — "this bundle was offered nothing"
      // is exactly the fact `alterRequest` needs.
      offered.set(
        bundleKey(entityType, bundle),
        new Set(matching.map((ref) => ref.field)),
      );
      if (matching.length === 0) return schema;
      const data = at(schema, 'properties', 'data');
      const attributes = at(data, 'properties', 'attributes');
      if (!isRecord(data) || !isRecord(attributes)) return schema;
      const synthetic: Json = {};
      for (const ref of matching) {
        synthetic[ref.field] = { type: 'string', title: ref.title };
      }
      return {
        ...schema,
        properties: {
          ...(isRecord(schema.properties) ? schema.properties : {}),
          data: {
            ...data,
            properties: {
              ...(isRecord(data.properties) ? data.properties : {}),
              attributes: {
                ...attributes,
                properties: {
                  ...(isRecord(attributes.properties)
                    ? attributes.properties
                    : {}),
                  ...synthetic,
                },
              },
            },
          },
        },
      };
    },

    async alterRequest(req: HttpRequest, ctx: RequestContext) {
      if (ctx.operation !== 'create' && ctx.operation !== 'update') return req;
      if (typeof req.body !== 'string' || req.body === '') return req;
      let doc: unknown;
      try {
        doc = JSON.parse(req.body);
      } catch {
        return req;
      }
      const data = at(doc, 'data');
      const attributes = at(data, 'attributes');
      if (!isRecord(doc) || !isRecord(data) || !isRecord(attributes))
        return req;
      const active = RESOLVERS.filter(
        (ref) => attributes[ref.field] !== undefined,
      );
      if (active.length === 0) return req;

      const nextAttributes = { ...attributes };
      const relationships = isRecord(data.relationships)
        ? { ...data.relationships }
        : {};

      const declaredHere = offered.get(bundleKey(ctx.entityType, ctx.bundle));

      for (const ref of active) {
        // A name field on a bundle that has no such relationship. Reachable by
        // a hand-built body or `--no-validate`, since the flag itself only
        // exists where the schema was extended. Inventing the relationship here
        // would send a document the server can only answer 422 to, naming a
        // field the caller never wrote.
        if (declaredHere !== undefined && !declaredHere.has(ref.field)) {
          throw new Error(
            `${ctx.entityType}/${ctx.bundle} declares no '${ref.relationship}' ` +
              `relationship, so '${ref.field}' cannot be resolved on this write. ` +
              `Remove it, or write to a bundle that has ${ref.relationship}.`,
          );
        }
        delete nextAttributes[ref.field];
        const names = String(attributes[ref.field])
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0);
        if (names.length === 0) continue;

        let index = indexes.get(ref.field);
        if (index === undefined) {
          index = fetchIndex(ctx, ref);
          indexes.set(ref.field, index);
        }
        const byName = await index;

        const scopeField = ref.scopeField;
        // The scope the payload already carries. Free — no round trip — so it
        // narrows EVERY name, including an unambiguous one: a name that is
        // unique across the whole collection can still belong to a different
        // parent than the entity being written, and attaching it silently would
        // be worse than the round trip we are saving. This shortcut only
        // applies when the payload carries the SAME relationship the target's
        // `scopeField` names; a chain resolver reaches the scope via a fetch
        // and never gets a free read here.
        const payloadScope =
          scopeField === undefined || ref.scopeChain !== undefined
            ? undefined
            : relationshipId(data, scopeField);

        const resolved: string[] = [];
        for (const name of names) {
          const candidates = byName.get(name) ?? [];
          const [only, ...rivals] = candidates;
          if (only === undefined) {
            throw new Error(
              `${ref.noun} name '${name}' does not exist in the ${ref.path} ` +
                `vocabulary. Known names: ${knownNames(byName)}`,
            );
          }

          if (scopeField === undefined) {
            if (rivals.length > 0) {
              throw new Error(
                `${ref.noun} name '${name}' is ambiguous — ${candidates.length} ` +
                  `entries in ${ref.path} share it. Candidates: ${describe(candidates)}. ` +
                  `Pass the uuid directly on the ${ref.relationship} relationship instead.`,
              );
            }
            resolved.push(only.id);
            continue;
          }

          // A scoped resolver ALWAYS establishes a scope — including for a name
          // that is unique across the whole collection today. Uniqueness is a
          // property of the current rows, not of the name: `staging` is unique
          // right up to the moment a second project creates one, and until then
          // an unscoped write would attach another project's environment and
          // report success. A chain resolver reaches the scope via a single
          // fetch (project + group + workspace in one round trip); a direct
          // resolver reads the scope off the entity being updated (also
          // memoised: one read per write, however many names were given). A
          // create has no entity yet, hence `undefined`.
          //
          // A chain resolver fetches ONLY when there is something to narrow
          // (multiple candidates). A single candidate needs no workspace check
          // and skips the round trip — the unscoped-path fallback below
          // resolves it directly. That keeps a write with one label and a
          // `project_id` on the payload at one URL per resolver, matching the
          // pre-fix cost.
          let scopeId: string | undefined;
          if (ref.scopeChain !== undefined) {
            if (rivals.length > 0) {
              let pending = chainScopes.get(ref.field);
              if (pending === undefined) {
                pending = resolveChainScope(req, ctx, ref, data);
                chainScopes.set(ref.field, pending);
              }
              scopeId = await pending;
            }
          } else {
            scopeId = payloadScope;
            if (scopeId === undefined) {
              let pending = scopes.get(scopeField);
              if (pending === undefined) {
                pending =
                  ctx.operation === 'update'
                    ? fetchScope(req, ctx, scopeField)
                    : Promise.resolve(undefined);
                scopes.set(scopeField, pending);
              }
              scopeId = await pending;
            }
          }

          // No scope at all is a hard error for a direct resolver (an
          // environment name must belong to a project — never guess). A
          // chain resolver falls back to the unscoped path instead: when no
          // `project_id` can be derived, a single candidate resolves
          // (backward-compatible with pre-fix writes) and multiple
          // candidates raise the same "ambiguous" error an unscoped resolver
          // would, with the candidate workspaces named via `describe()`.
          if (scopeId === undefined) {
            if (ref.scopeChain !== undefined) {
              if (rivals.length > 0) {
                throw new Error(
                  `${ref.noun} name '${name}' is ambiguous — ${candidates.length} ` +
                    `entries in ${ref.path} share it. Candidates: ${describe(candidates)}. ` +
                    `Pass the uuid directly on the ${ref.relationship} relationship instead.`,
                );
              }
              resolved.push(only.id);
              continue;
            }
            throw new Error(
              rivals.length > 0
                ? `${ref.noun} name '${name}' is ambiguous — ${candidates.length} ` +
                    `entries in ${ref.path} share it and the write carries no ` +
                    `${scopeField} to narrow them. Candidates: ${describe(candidates)}. ` +
                    `Pass the uuid directly on the ${ref.relationship} relationship instead.`
                : `${ref.noun} name '${name}' cannot be resolved: ${ref.path} names are ` +
                    `unique only within ${scopeField}, and this write carries no ` +
                    `${scopeField} to narrow it — being the only '${name}' that exists ` +
                    `today does not make it this write's. Candidate: ${describe(candidates)}. ` +
                    `Name the ${scopeField}, or pass the uuid directly on the ` +
                    `${ref.relationship} relationship instead.`,
            );
          }

          const [match, ...extra] = candidates.filter(
            (c) => c.scopeId === scopeId,
          );
          if (match === undefined) {
            const elsewhere = candidates
              .map((c) => c.scopeId ?? '(none)')
              .join(', ');
            throw new Error(
              `${ref.noun} name '${name}' does not exist in ${scopeField} ` +
                `'${scopeId}'. It exists in: ${elsewhere}.`,
            );
          }
          if (extra.length > 0) {
            throw new Error(
              `${ref.noun} name '${name}' is ambiguous even within ${scopeField} ` +
                `'${scopeId}': ${describe([match, ...extra])}. Pass the uuid directly ` +
                `on the ${ref.relationship} relationship instead.`,
            );
          }
          resolved.push(match.id);
        }

        const current = at(relationships, ref.relationship, 'data');
        const existing = Array.isArray(current)
          ? current
          : current !== undefined
            ? [current]
            : [];
        const merged: Json[] = [];
        const seen = new Set<string>();
        for (const entry of [
          ...existing,
          ...resolved.map((id) => ({ type: ref.type, id })),
        ]) {
          const id = isRecord(entry) ? entry.id : undefined;
          if (typeof id !== 'string' || seen.has(id)) continue;
          seen.add(id);
          merged.push(entry as Json);
        }
        if (merged.length > 0) {
          relationships[ref.relationship] = { data: merged };
        }
      }

      const nextData: Json = { ...data };
      if (Object.keys(nextAttributes).length > 0)
        nextData.attributes = nextAttributes;
      else delete nextData.attributes;
      if (Object.keys(relationships).length > 0)
        nextData.relationships = relationships;

      return { ...req, body: JSON.stringify({ ...doc, data: nextData }) };
    },
  };
}
