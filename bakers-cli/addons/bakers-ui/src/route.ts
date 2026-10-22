// BB-223: deep-link resolution — the unresolved CLI route (`UiInitialRoute`)
// against the control plane into the renderer's `ResolvedRoute`.
//
// WHERE this runs matters (spec Decision 5). The `bakers ui` entry has no JSON:API
// client at all — the client first exists as `services.client` inside the dropsh
// program, in the renderer's `run()`. That is the earliest point resolution can
// happen, and it is still strictly BEFORE `runTicketTui` reaches
// `input.setRawMode(true)`. So every failure here throws out of `run()`, through
// `parseAsync`, into `cmdUi`'s catch: no alternate screen, no raw mode, no
// projects screen — a stderr line and exit 1 (AC-3).

import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { asString } from './lib/format.js';
import { serverMessage } from './lib/jsonapi-error.js';
import { normalizeRepoUrl } from './lib/repo-url.js';
import type {
  DropshClient,
  JsonApiResource,
  ResolvedRoute,
  UiInitialRoute,
} from './types.js';

/** Context for the error messages — which control plane was asked. */
export interface ResolveRouteContext {
  baseUrl?: string | undefined;
}

/** A JSON:API single-resource document. */
interface SingleDoc {
  data?: JsonApiResource | null;
}

/** A JSON:API collection document. */
interface CollectionDoc {
  data?: JsonApiResource[];
}

/** `" on <baseUrl>"`, or '' when the caller did not supply one. */
function on(ctx: ResolveRouteContext | undefined): string {
  return ctx?.baseUrl ? ` on ${ctx.baseUrl}` : '';
}

/** `" (from branch '<b>')"` — so a branch-derived over-match (`release/v2-2026`
 *  → `V2-2026`, spec § Risks) explains itself instead of looking like a typo. */
function via(route: UiInitialRoute): string {
  return route.fromBranch ? ` (derived from branch '${route.fromBranch}')` : '';
}

/** Read a single resource, mapping any transport failure to `undefined` so the
 *  caller always produces the same named, actionable error. */
async function getOne(
  client: DropshClient,
  path: string,
): Promise<JsonApiResource | undefined> {
  const doc = (await client.get(path).catch(() => undefined)) as
    | SingleDoc
    | undefined;
  return doc?.data ?? undefined;
}

/** The id of a single-valued relationship linkage, or null. */
function relId(resource: JsonApiResource, name: string): string | null {
  const data = resource.relationships?.[name]?.data;
  if (!data) return null;
  return Array.isArray(data) ? (data[0]?.id ?? null) : (data.id ?? null);
}

async function resolveTicketByUuid(
  client: DropshClient,
  route: UiInitialRoute,
  ctx: ResolveRouteContext | undefined,
): Promise<ResolvedRoute> {
  const found = await getOne(client, `bb_ticket/bb_ticket/${route.value}`);
  if (!found?.id) {
    throw new Error(`no ticket ${route.value}${on(ctx)}${via(route)}.`);
  }
  return { screen: 'ticket', ticketId: found.id, view: route.view ?? 'full' };
}

async function resolveTicketByIdentifier(
  client: DropshClient,
  route: UiInitialRoute,
  ctx: ResolveRouteContext | undefined,
): Promise<ResolvedRoute> {
  // Pages to TWO, not one: identifiers are unique per PROJECT, so a
  // cross-project collision is possible in principle. Fetching a second row
  // turns a silent wrong-ticket into a named ambiguity (spec Decision 6).
  const params = new DrupalJsonApiParams();
  params.addFilter('identifier', route.value);
  params.addPageLimit(2);
  const doc = (await client
    .get('bb_ticket/bb_ticket', params)
    .catch(() => undefined)) as CollectionDoc | undefined;
  const rows = doc?.data ?? [];

  if (rows.length === 0) {
    throw new Error(`no ticket ${route.value}${on(ctx)}${via(route)}.`);
  }
  if (rows.length > 1) {
    const candidates = rows
      .map((r) => `  ticket:${r.id} — ${asString(r.attributes?.title) ?? ''}`)
      .join('\n');
    throw new Error(
      `${route.value} matches ${rows.length} tickets${on(ctx)}${via(route)}. ` +
        `Name one with 'ticket:<uuid>':\n${candidates}`,
    );
  }
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`no ticket ${route.value}${on(ctx)}${via(route)}.`);
  }
  return { screen: 'ticket', ticketId: id, view: route.view ?? 'full' };
}

/**
 * A ticket by its origin issue (BB-544). The server owns the grammar: the
 * reference goes out verbatim as `filter[search]`, and an unknown or ambiguous
 * alias comes back as a 400 whose message is passed on unchanged. Several
 * tickets may share one origin; like an identifier collision, that is named
 * with the candidates rather than guessed.
 */
async function resolveTicketByOrigin(
  client: DropshClient,
  route: UiInitialRoute,
  ctx: ResolveRouteContext | undefined,
): Promise<ResolvedRoute> {
  const params = new DrupalJsonApiParams();
  params.addFilter('search', route.value);
  params.addFields('bb_ticket--bb_ticket', ['identifier', 'title']);
  params.addPageLimit(20);
  const doc = (await client
    .get('bb_ticket/bb_ticket', params)
    .catch((error: unknown) => {
      throw new Error(`${route.value}${on(ctx)}: ${serverMessage(error)}`);
    })) as CollectionDoc | undefined;
  const rows = doc?.data ?? [];

  if (rows.length === 0) {
    throw new Error(`no ticket has the origin ${route.value}${on(ctx)}.`);
  }
  if (rows.length > 1) {
    const candidates = rows
      .map(
        (r) =>
          `  ticket:${r.id} — ${asString(r.attributes?.identifier) ?? ''} ${asString(r.attributes?.title) ?? ''}`,
      )
      .join('\n');
    throw new Error(
      `${route.value} is the origin of ${rows.length} tickets${on(ctx)}. ` +
        `Name one with 'ticket:<uuid>':\n${candidates}`,
    );
  }
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`no ticket has the origin ${route.value}${on(ctx)}.`);
  }
  return { screen: 'ticket', ticketId: id, view: route.view ?? 'full' };
}

/**
 * The repo URLs a `bb_project` row declares, normalised. `repository` is a
 * single-cardinality `bb_repo` field: JSON:API serves it as one object
 * (measured on this branch's DDEV), but both a JSON *string* and an array are
 * tolerated too, so a differently-serialized deployment does not silently stop
 * matching. Anything unparseable yields no URLs — a malformed value is
 * skipped, never fatal.
 */
function projectRepoIdentities(resource: JsonApiResource): string[] {
  const raw = resource.attributes?.repository;
  let entry: unknown = raw;
  if (typeof raw === 'string') {
    try {
      entry = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const entries = Array.isArray(entry) ? entry : [entry];
  const out: string[] = [];
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const normalised = normalizeRepoUrl((item as { url?: unknown }).url);
    if (normalised !== undefined) out.push(normalised);
  }
  return out;
}

/**
 * The `--here` project rung (spec Decision 3): the project(s) whose
 * `repository` claims the cwd's normalised git remote.
 *
 * The match is CLIENT-SIDE by necessity, not by taste — `filter[repository]=…`
 * answers **HTTP 400** (measured): `repository` is a JSON field on the entity,
 * not a relationship JSON:API can filter inside. So this reads the project
 * collection (a handful of rows) and matches in memory: one round trip, the
 * same one a name lookup would have cost.
 *
 * Zero matches is the one hard error. TWO OR MORE is NOT — a repo claimed by
 * several projects is a designed-for topology (Decision 14, AC-8), so it
 * resolves to the picker screen.
 */
async function resolveProjectByRepo(
  client: DropshClient,
  route: UiInitialRoute,
  ctx: ResolveRouteContext | undefined,
): Promise<ResolvedRoute> {
  const params = new DrupalJsonApiParams();
  params.addFields('bb_project--bb_project', ['name', 'repository']);
  params.addPageLimit(200);
  const doc = (await client
    .get('bb_project/bb_project', params)
    .catch(() => undefined)) as CollectionDoc | undefined;
  const rows = doc?.data ?? [];

  const candidates = rows
    .filter((r) => projectRepoIdentities(r).includes(route.value))
    .map((r) => ({
      id: r.id ?? '',
      name: asString(r.attributes?.name) ?? '',
    }))
    .filter((c) => c.id !== '');

  if (candidates.length === 0) {
    const known = rows
      .map((r) => asString(r.attributes?.name))
      .filter((n): n is string => Boolean(n));
    const list = known.length ? known.join(', ') : '(none visible)';
    throw new Error(
      `no bakers project owns the repo ${route.value}${on(ctx)}${via(route)}.\n` +
        `  Known projects: ${list}\n` +
        "  Run 'bakers ui' and press Tab for the project list, or 'bakers ui project:<name>' to open one directly.",
    );
  }
  if (candidates.length === 1) {
    const only = candidates[0] as { id: string; name: string };
    return {
      screen: 'project',
      projectId: only.id,
      projectName: only.name || route.value,
    };
  }
  return { screen: 'project-picker', repo: route.value, candidates };
}

async function resolveProject(
  client: DropshClient,
  route: UiInitialRoute,
  ctx: ResolveRouteContext | undefined,
): Promise<ResolvedRoute> {
  if (route.by === 'repo') return resolveProjectByRepo(client, route, ctx);
  if (route.by === 'uuid') {
    const found = await getOne(client, `bb_project/bb_project/${route.value}`);
    if (!found?.id) {
      throw new Error(`no project ${route.value}${on(ctx)}${via(route)}.`);
    }
    return {
      screen: 'project',
      projectId: found.id,
      projectName: asString(found.attributes?.name) ?? route.value,
    };
  }
  // By NAME — the same `collection('bb_project').where('name','=',…)` read
  // the project screen already performs, so both agree on what a name means.
  const found = await client
    .collection('bb_project')
    .where('name', '=', route.value)
    .first()
    .catch(() => null);
  if (!found) {
    throw new Error(
      `no project named '${route.value}'${on(ctx)}${via(route)}.`,
    );
  }
  return {
    screen: 'project',
    projectId: found.id,
    projectName: (found.attr('name') as string | undefined) ?? route.value,
  };
}

async function resolveRun(
  client: DropshClient,
  route: UiInitialRoute,
  ctx: ResolveRouteContext | undefined,
): Promise<ResolvedRoute> {
  const found = await getOne(
    client,
    `bb_run/bb_run/${route.value}?include=ticket_id`,
  );
  if (!found?.id) {
    throw new Error(`no run ${route.value}${on(ctx)}${via(route)}.`);
  }
  const ticketId = relId(found, 'ticket_id');
  if (!ticketId) {
    throw new Error(`run ${route.value} has no ticket${on(ctx)}.`);
  }
  // Decision 2: the observable meaning of a `run:` target is the owning
  // ticket's detail screen with the Runs tab active. `runId` rides along even
  // though nothing renders it, so a later dedicated run screen is a purely
  // renderer-internal change.
  return {
    screen: 'ticket',
    ticketId,
    view: 'full',
    tab: 'runs',
    runId: found.id,
  };
}

/**
 * Resolve a CLI deep-link target into the screen the kernel should boot.
 * Throws — always with a message naming the target and the control plane — when
 * the target does not exist or is ambiguous.
 */
export function resolveRoute(
  client: DropshClient,
  route: UiInitialRoute,
  ctx?: ResolveRouteContext,
): Promise<ResolvedRoute> {
  if (route.kind === 'run') return resolveRun(client, route, ctx);
  if (route.kind === 'project') return resolveProject(client, route, ctx);
  if (route.by === 'origin') return resolveTicketByOrigin(client, route, ctx);
  return route.by === 'uuid'
    ? resolveTicketByUuid(client, route, ctx)
    : resolveTicketByIdentifier(client, route, ctx);
}
