import type {
  Collection,
  DropshClient,
  Resource,
  ResourceWriteBody,
} from '../src/types.js';

interface RawResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { data?: { id: string } | Array<{ id: string }> | null } | undefined
  >;
}

// Faithful mirror of dropsh 0.5.7's `toResource`
// (dropsh/dist/src/core/jsonapi/resource.js). dropsh does not export it from
// its public entry, so the fakes reproduce the exact accessor contract the real
// `client.collection(...).list()/.first()` returns: `{ id, type, raw, attr(k),
// rel(k), rels(k) }` — NOT a raw `{attributes, relationships}` object. Wrapping
// fixtures with this makes an attribute/relationship-accessor regression fail
// loudly instead of silently reading `undefined`.
export function toResource(obj: RawResource): Resource {
  return {
    id: obj.id,
    type: obj.type,
    raw: obj,
    attr(key: string) {
      return obj.attributes?.[key];
    },
    rel(key: string) {
      const data = obj.relationships?.[key]?.data;
      if (data === undefined || data === null) return null;
      if (Array.isArray(data)) return data[0]?.id ?? null;
      return data.id;
    },
    rels(key: string) {
      const data = obj.relationships?.[key]?.data;
      if (data === undefined || data === null) return [];
      if (Array.isArray(data)) return data.map((d) => d.id);
      return [data.id];
    },
  } as Resource;
}

/**
 * Faithful mirror of dropsh 0.5.8's `resolveType`
 * (`dropsh/dist/src/core/jsonapi/types.js`), reduced to the `path` half — the
 * `entity/bundle` the real client actually requests.
 *
 * The fake has to resolve a collection spec the way dropsh does, for the same
 * reason it has to mirror `toResource`: it must answer what the real client
 * would ASK. dropsh expands a single-segment shorthand to `<t>/<t>`, so
 * `collection('bb_term')` addresses the bundle `bb_term/bb_term`. Keying
 * fixtures by the raw string hid that expansion, and with it the whole
 * bundle-path class of defect — BB-257 F2 (`bb_term/bb_term` does not
 * exist and 404s; the vocabulary is `bb_term/label`) sat in the tree
 * with a green suite precisely because no fake ever resolved the spec (F2b).
 */
export function resolveCollectionPath(spec: string): string {
  if (spec.includes('--')) return spec.replace(/--/g, '/');
  if (spec.includes('/')) return spec;
  return `${spec}/${spec}`;
}

/** A recorded `client.get(...)` call, path AND params (BB-257). */
export interface RecordedGet {
  path: string;
  /** The `DrupalJsonApiParams` the caller passed, if any — typed `unknown` for
   *  the same reason `DropshClient.get` types it so: the shared contract must
   *  not leak the dep. A caller that wants to assert on it narrows it itself. */
  params: unknown;
}

/** The query string a recorded `params` serializes to, decoded for reading. */
export function queryStringOf(params: unknown): string {
  const getQueryString = (params as { getQueryString?: () => string } | null)
    ?.getQueryString;
  return typeof getQueryString === 'function'
    ? decodeURIComponent(getQueryString.call(params))
    : '';
}

/** A recorded `client.update(...)` call. */
export interface RecordedWrite {
  type: string;
  id: string;
  body: ResourceWriteBody;
}

/** A recorded `client.create(...)` call (BB-309). */
export interface RecordedCreate {
  type: string;
  body: ResourceWriteBody;
}

/** A recorded `client.post(...)` call. */
export interface RecordedPost {
  path: string;
  body: unknown;
}

/** A `DropshClient` double that records every call it is handed (BB-233). */
export interface FakeClient extends DropshClient {
  /** Every `update()` in call order — the AC-6 "no write happened" assertion. */
  readonly writes: RecordedWrite[];
  /** Every `create()` in call order — the AC-2 "exactly one ticket" assertion. */
  readonly creates: RecordedCreate[];
  /** Every `get()` path in call order. */
  readonly gets: string[];
  /**
   * The same calls with their QUERY PARAMS (BB-257). `gets` alone cannot tell
   * one `bb_ticket/bb_ticket` read from another, and the parent picker's
   * whole contract is which filters it puts on the wire.
   */
  readonly requests: RecordedGet[];
  /**
   * Every `collection()` call in order, as the RESOLVED `entity/bundle` path —
   * what dropsh would put on the wire, not the shorthand the caller wrote. That
   * is the thing worth asserting: `bb_term` and `bb_term/label` are
   * two different requests and only one of them exists (BB-257 F2).
   */
  readonly collections: string[];
  /** Every `post()` in call order. */
  readonly posts: RecordedPost[];
  /** Every `where(path, op, value)` filter any collection received. */
  readonly filters: string[][];
}

export interface FakeClientOptions {
  /**
   * Rows per collection; a missing collection yields an empty list. A key may
   * be written in EITHER form — the shorthand (`user`), the path
   * (`bb_term/label`) or the type (`user--user`) — because it is
   * compared after resolution, exactly as the request is.
   */
  rows?: Record<string, Resource[]>;
  /** Documents per `get()` path prefix; the first match wins. */
  documents?: Record<string, unknown>;
  /** Collections whose `list()` throws — the best-effort/AC-7 path. Keyed in
   *  either form, like `rows`. */
  failingCollections?: string[];
  /**
   * `get()` paths (by PREFIX) whose read throws. Deliberately separate from
   * `failingCollections`: the two are different routes to the server —
   * `collection().list()` and `get(path, params)` — and a fixture that fails
   * one must be able to leave the other working (BB-257).
   */
  failingPaths?: string[];
  /** When set, every `update()` rejects with this value (the AC-5 path). */
  writeError?: unknown;
  /** When set, every `create()` rejects with this value (the AC-8 path). */
  createError?: unknown;
  /** The uuid the created resource reports back; defaults to a fixed one. */
  createdId?: string;
  /** What every `post()` answers (the instantiate document). */
  postDocument?: unknown;
  /** When set, every `post()` rejects with this value. */
  postError?: unknown;
}

/**
 * The shared client double. Widening `DropshClient` with `update()` (spec
 * Decision 2) means every fake must carry it; building them in ONE place keeps
 * a future contract change to a single edit instead of one per test file.
 */
export function fakeClient(options: FakeClientOptions = {}): FakeClient {
  const {
    rows = {},
    documents = {},
    failingCollections = [],
    failingPaths = [],
    writeError,
    createError,
    createdId,
    postDocument,
    postError,
  } = options;
  const posts: RecordedPost[] = [];
  const filters: string[][] = [];
  const writes: RecordedWrite[] = [];
  const creates: RecordedCreate[] = [];
  const gets: string[] = [];
  const requests: RecordedGet[] = [];
  const collections: string[] = [];

  const collection = (type: string): Collection => {
    const path = resolveCollectionPath(type);
    collections.push(path);
    const fails = failingCollections.some(
      (spec) => resolveCollectionPath(spec) === path,
    );
    const bag =
      Object.entries(rows).find(
        ([key]) => resolveCollectionPath(key) === path,
      )?.[1] ?? [];
    const c: Collection = {
      where: (...args: unknown[]) => {
        filters.push(args.map(String));
        return c;
      },
      sort: () => c,
      page: () => c,
      first: async () => {
        if (fails) throw new Error(`no ${path}`);
        return bag[0] ?? null;
      },
      list: async () => {
        if (fails) throw new Error(`no ${path}`);
        return bag;
      },
    };
    return c;
  };

  return {
    writes,
    creates,
    gets,
    requests,
    collections,
    posts,
    filters,
    collection,
    post: async (path: string, body: unknown) => {
      posts.push({ path, body });
      if (postError !== undefined) throw postError;
      return postDocument ?? { data: [] };
    },
    get: async (path: string, params?: unknown) => {
      gets.push(path);
      requests.push({ path, params });
      if (failingPaths.some((prefix) => path.startsWith(prefix))) {
        throw new Error(`no ${path}`);
      }
      const hit = Object.keys(documents).find((prefix) =>
        path.startsWith(prefix),
      );
      if (hit !== undefined) return documents[hit];
      return { data: [] };
    },
    update: async (type: string, id: string, body: ResourceWriteBody) => {
      writes.push({ type, id, body });
      if (writeError !== undefined) throw writeError;
      return { data: { type, id } };
    },
    create: async (type: string, body: ResourceWriteBody) => {
      creates.push({ type, body });
      if (createError !== undefined) throw createError;
      // dropsh 0.5.8's `create` ends `return toResource(doc.data)` — it hands
      // back a RESOURCE, with a top-level `id`, not the JSON:API document it
      // received (`dropsh/dist/src/core/jsonapi/client.js`). The document shape
      // this used to return was copied from the `update` double, whose return
      // value no production code reads; BB-309 is the first caller to read a
      // write's result, and a double that disagrees with its seam is exactly
      // where that starts costing something.
      return toResource({ id: createdId ?? 'created-ticket-uuid', type });
    },
  };
}
