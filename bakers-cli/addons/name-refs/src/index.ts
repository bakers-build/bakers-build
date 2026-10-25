// BB-403: resolve entity NAMES into the relationship that references them, so
// a skill writes `--type_names bug` or `--environment_names staging`
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
// Adding a target is one RESOLVERS entry. Both kinds of name are unique only
// within a parent. `bb_environment` names are unique WITHIN A PROJECT
// (BbEnvironmentUniquePerProject), which the write carries directly — hence
// `scopeField`. `bb_term` names (ticket type, recipe, label) are unique within
// the ticket's WORKSPACE, reached through `scopeChain`; a term name missing
// there is created there, so an agent never needs a lead to add vocabulary.

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
  /** The relationship holds one value: a name replaces it instead of appending. */
  single?: boolean;
}

/** A term resolver: workspace-scoped, created on first use. */
const term = (
  field: string,
  noun: string,
  relationship: string,
  vid: string,
  single: boolean,
): NameRef => ({
  field,
  noun,
  relationship,
  type: `bb_term--${vid}`,
  path: `bb_term/${vid}`,
  title:
    `${noun[0]?.toUpperCase()}${noun.slice(1)} names (comma-separated ${vid} term names` +
    `${single ? '; one name' : ''}; resolved in the ticket's workspace and ` +
    'created there when missing, on the live write)',
  scopeField: 'workspace_id',
  scopeChain: 'project_id.group_id.workspace_id',
  single,
});

const WORKSPACE_TYPE = 'bb_workspace--bb_workspace';

const RESOLVERS: NameRef[] = [
  term('type_names', 'ticket type', 'ticket_type', 'type', true),
  term('recipe_names', 'recipe', 'recipe', 'recipe', true),
  term('label_names', 'label', 'labels', 'label', false),
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
 * How many known names an error may list. A term bundle is small; a future
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
 * target type, in the cardinality the resolver writes? A single resolver
 * writes one object, a multi-valued one an array; matching the other shape
 * would produce an invalid payload.
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
    ...(ref.single ? [] : ['items']),
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
  return sendDoc(ctx, { method: 'GET', url }, `could not read ${what}`);
}

/** Send one JSON:API request and parse its document, or fail by name. */
async function sendDoc(
  ctx: RequestContext,
  req: HttpRequest,
  failure: string,
): Promise<unknown> {
  const url = req.url;
  const res = await ctx.http.send(
    await ctx.auth.apply({
      ...req,
      headers: {
        Accept: 'application/vnd.api+json',
        ...(req.body === undefined
          ? {}
          : { 'Content-Type': 'application/vnd.api+json' }),
      },
    }),
  );
  if (res.status < 200 || res.status >= 300) {
    const expiry =
      res.status === 401 || res.status === 403
        ? ' The access token may have expired: this plugin performs its own reads ' +
          'and, unlike dropsh’s JSON:API client, cannot renew one, so an expired ' +
          'token surfaces here instead of being refreshed. Re-authenticate and retry.'
        : '';
    throw new Error(`${failure}: HTTP ${res.status} from ${url}.${expiry}`);
  }
  try {
    return JSON.parse(res.body);
  } catch (cause) {
    throw new Error(
      `${failure}: ${url} answered ${res.status} but not JSON (${String(cause)})`,
    );
  }
}

/** Create a term in a workspace and return its uuid. */
async function createTerm(
  ctx: RequestContext,
  ref: NameRef,
  name: string,
  workspaceId: string,
): Promise<string> {
  const prefix = normalisePrefix(ctx.jsonapiPrefix);
  const doc = await sendDoc(
    ctx,
    {
      method: 'POST',
      url: `${ctx.baseUrl.replace(/\/+$/, '')}${prefix}/${ref.path}`,
      body: JSON.stringify({
        data: {
          type: ref.type,
          attributes: { name },
          relationships: {
            workspace_id: { data: { type: WORKSPACE_TYPE, id: workspaceId } },
          },
        },
      }),
    },
    `could not create ${ref.noun} '${name}' in workspace '${workspaceId}'`,
  );
  const id = at(doc, 'data', 'id');
  if (typeof id !== 'string') {
    throw new Error(
      `could not create ${ref.noun} '${name}': the response carries no id`,
    );
  }
  return id;
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

/**
 * One term name → its uuid in the ticket's workspace, created there when
 * missing. Without a workspace (a create naming no project) nothing can be
 * created and only an unambiguous existing name resolves.
 */
async function resolveTerm(
  ctx: RequestContext,
  ref: NameRef,
  byName: Map<string, Candidate[]>,
  name: string,
  workspaceId: string | undefined,
): Promise<string> {
  const candidates = byName.get(name) ?? [];
  if (workspaceId === undefined) {
    const [only, ...rivals] = candidates;
    if (only === undefined) {
      throw new Error(
        `${ref.noun} name '${name}' does not exist in the ${ref.path} ` +
          `vocabulary, and this write names no project_id whose workspace it ` +
          `could be created in. Known names: ${knownNames(byName)}`,
      );
    }
    if (rivals.length > 0) {
      throw new Error(
        `${ref.noun} name '${name}' is ambiguous — ${candidates.length} ` +
          `entries in ${ref.path} share it. Candidates: ${describe(candidates)}. ` +
          `Pass the uuid directly on the ${ref.relationship} relationship instead.`,
      );
    }
    return only.id;
  }
  const [match, ...extra] = candidates.filter((c) => c.scopeId === workspaceId);
  if (extra.length > 0 && match !== undefined) {
    throw new Error(
      `${ref.noun} name '${name}' is ambiguous even within workspace_id ` +
        `'${workspaceId}': ${describe([match, ...extra])}. Pass the uuid ` +
        `directly on the ${ref.relationship} relationship instead.`,
    );
  }
  if (match !== undefined) return match.id;
  const id = await createTerm(ctx, ref, name, workspaceId);
  byName.set(name, [...candidates, { id, scopeId: workspaceId }]);
  return id;
}

/**
 * One name → its uuid within the parent the write carries (`scopeField`),
 * read off the entity under update when the payload omits it.
 */
async function resolveScoped(
  req: HttpRequest,
  ctx: RequestContext,
  ref: NameRef,
  data: unknown,
  byName: Map<string, Candidate[]>,
  name: string,
  scopes: Map<string, Promise<string | undefined>>,
): Promise<string> {
  const candidates = byName.get(name) ?? [];
  const [only, ...rivals] = candidates;
  if (only === undefined) {
    throw new Error(
      `${ref.noun} name '${name}' does not exist in the ${ref.path} ` +
        `vocabulary. Known names: ${knownNames(byName)}`,
    );
  }
  const scopeField = ref.scopeField;
  if (scopeField === undefined) {
    if (rivals.length > 0) {
      throw new Error(
        `${ref.noun} name '${name}' is ambiguous — ${candidates.length} ` +
          `entries in ${ref.path} share it. Candidates: ${describe(candidates)}. ` +
          `Pass the uuid directly on the ${ref.relationship} relationship instead.`,
      );
    }
    return only.id;
  }

  // A scoped resolver ALWAYS establishes a scope — including for a name that
  // is unique across the whole collection today. Uniqueness is a property of
  // the current rows, not of the name: `staging` is unique right up to the
  // moment a second project creates one, and until then an unscoped write
  // would attach another project's environment and report success. The scope
  // the payload carries is free; otherwise it is read off the entity being
  // updated (memoised: one read per write, however many names were given). A
  // create has no entity yet, hence `undefined`.
  let scopeId = relationshipId(data, scopeField);
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
  if (scopeId === undefined) {
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

  const [match, ...extra] = candidates.filter((c) => c.scopeId === scopeId);
  if (match === undefined) {
    const elsewhere = candidates.map((c) => c.scopeId ?? '(none)').join(', ');
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
  return match.id;
}

export function nameRefsPlugin(): DropSHPlugin {
  // Per-instance, not module-level: one CLI invocation performs one write, so
  // these guard against a second lookup, and they keep tests isolated.
  const indexes = new Map<string, Promise<Map<string, Candidate[]>>>();
  const scopes = new Map<string, Promise<string | undefined>>();
  /**
   * Chain-scope resolutions, keyed by the chain: the three term resolvers share
   * one, and a chain resolution is a round trip we want to pay once per write.
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

      const namesOf = (ref: NameRef) => [
        ...new Set(
          String(attributes[ref.field])
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name.length > 0),
        ),
      ];
      // Before any round trip: a single-valued field takes one name.
      for (const ref of active) {
        if (ref.single && namesOf(ref).length > 1) {
          throw new Error(
            `'${ref.field}' takes one name: ${ref.relationship} holds a single ${ref.noun}.`,
          );
        }
      }

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
        const names = namesOf(ref);
        if (names.length === 0) continue;

        let index = indexes.get(ref.field);
        if (index === undefined) {
          index = fetchIndex(ctx, ref);
          indexes.set(ref.field, index);
        }
        const byName = await index;

        const resolved: string[] = [];
        if (ref.scopeChain !== undefined) {
          // A term always belongs to the ticket's workspace: one fetch walks
          // project → group → workspace, shared by all term fields of the write.
          let pending = chainScopes.get(ref.scopeChain);
          if (pending === undefined) {
            pending = resolveChainScope(req, ctx, ref, data);
            chainScopes.set(ref.scopeChain, pending);
          }
          const workspaceId = await pending;
          for (const name of names) {
            resolved.push(
              await resolveTerm(ctx, ref, byName, name, workspaceId),
            );
          }
        } else {
          for (const name of names) {
            resolved.push(
              await resolveScoped(req, ctx, ref, data, byName, name, scopes),
            );
          }
        }

        if (ref.single) {
          const [id] = resolved;
          if (id !== undefined) {
            relationships[ref.relationship] = { data: { type: ref.type, id } };
          }
          continue;
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
