// Project-scoped run list reads — through the dropsh JSON:API client
// (`services.client`). Every rendered object is a `bb_run` Drupal entity
// (AC-5). Runs are scoped to the selected project via the nested filter
// `ticket_id.project_id.id` (a project may span several conductors, so the
// ticket→project relationship is the canonical scope, not `conductor_id`).
// The query itself lives in `./query.ts` (BB-282); `ticketRunRows` stays a
// no-request read of the ticket document (spec D7).

import type { DropshClient, JsonApiResource } from '../../../types.js';
import {
  type ListColumn,
  type ListTable,
  loadPage,
  type Page,
  type PageWindow,
} from '../../collection.js';
import { LIST_PAGE_SIZE } from '../../cycle.js';
import {
  buildRunQueryParams,
  buildUserRunQueryParams,
  type RunCriteria,
} from './query.js';
import { deriveRunStatus, runStartedAge } from './status.js';

/** One flat-table row derived from a `bb_run` dropsh resource. */
export interface RunRow {
  id: string;
  /** The `#844`-style internal id (human handle in the RUN column). */
  drupalId: number | string | null;
  /** The run's ticket relationship id, or null when absent. */
  ticketId: string | null;
  /** The ticket's `identifier` from the sideloaded include, or '—'. */
  ticketIdentifier: string;
  /** The ticket's `title` from the sideloaded include, or '' when the
   *  include did not carry one (only the conductor-scoped query asks). */
  ticketTitle: string;
  /** Authoritative run state (`claimed|running|done|expired|failed`). */
  state: string;
  /** The ticket state the run was dispatched for (`state_at_start`). */
  phase: string;
  /** The executing agent (`claude`, `codex`, …). */
  agent: string;
  /** ISO start time; falls back to `created` when the run never started. */
  startedAt: string | null;
  heartbeat: string | null;
  claimExpiresAt: string | null;
  /** Boolean closed flag; an absent attribute reads as open (spec D5). */
  closed: boolean;
}

/** Read a value as a string, or `undefined` when it is not one. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** In the fieldset, or the sideloaded ticket stops resolving (spec fact 5). */
export const RUN_LIST_RELATIONSHIPS = ['ticket_id'] as const;
type RunListRelationship = (typeof RUN_LIST_RELATIONSHIPS)[number];

/** Requested, rendered by no column: `closed` feeds the closed predicate in
 *  `RunsScreen.load`. */
const RUN_PREDICATE_ATTRIBUTES = ['closed'] as const;

/**
 * The run list's columns — RUN · TICKET · STATE · PHASE · AGENT · STARTED, each
 * carrying its own fieldset entry (BB-294 AC 4).
 *
 * `Ctx` is `nowSeconds`: STATE is the derived liveness status and STARTED the
 * relative start age, and both need a clock the row does not carry.
 */
export const RUN_COLUMNS = [
  {
    key: 'run',
    label: 'RUN',
    width: 8,
    fields: ['drupal_internal__id'],
    get: (r: RunRow) => `#${r.drupalId ?? r.id.slice(0, 6)}`,
  },
  {
    key: 'ticket',
    label: 'TICKET',
    width: 10,
    fields: ['ticket_id'],
    get: (r: RunRow) => r.ticketIdentifier,
  },
  {
    // Three fields for one column: `deriveRunStatus` reads the run's own state
    // plus its heartbeat and claim window.
    //
    // BB-345 — DELIBERATELY unbounded, unlike the ticket list's STATE. This
    // column's vocabulary is `RunStatus`, whose longest member is 7 characters
    // (`running`/`claimed`/`expired`), so a width of 8 already shows every one of
    // them whole and there is nothing for a `max` to cap or a `grow` to fix. The
    // bound would be a constant nobody reads; the vocabulary is the reason.
    key: 'state',
    label: 'STATE',
    width: 8,
    fields: ['state', 'heartbeat', 'claim_expires_at'],
    get: (r: RunRow, nowSeconds: number) => deriveRunStatus(r, nowSeconds),
  },
  {
    // BB-345 D3 — the phase is the ticket state the run STARTED in, so its
    // vocabulary is the ticket workflow's state_flow and its longest member is
    // `qualification` at 13. Same domain constant as the ticket list's STATE,
    // and fixed at it for the same measured reason given there.
    key: 'phase',
    label: 'PHASE',
    width: 13,
    fields: ['state_at_start'],
    get: (r: RunRow) => r.phase,
  },
  {
    key: 'agent',
    label: 'AGENT',
    width: 8,
    fields: ['agent'],
    get: (r: RunRow) => r.agent,
  },
  {
    // The trailing column, unpadded. `created` is `started_at`'s documented
    // fallback for a run that never started.
    //
    // The one grower of the run list, and so the column the surplus goes to
    // (BB-345 D3). No `min`, for the reason the ticket list's TITLE gives.
    key: 'started',
    label: 'STARTED',
    width: 0,
    grow: 1,
    fields: ['started_at', 'created'],
    get: (r: RunRow, nowSeconds: number) => runStartedAge(r, nowSeconds),
  },
] as const satisfies readonly ListColumn<RunRow, number>[];

/**
 * The run list, declared once (BB-345 D2/D10).
 *
 * `Ctx` is `nowSeconds`: the STATE and STARTED columns are clock-dependent, and
 * the clock is a per-render value the row does not carry.
 *
 * BB-255 AC-6 asks for a run to look the same on the project-wide Runs screen
 * and on the ticket detail's Runs tab. ONE configuration is that claim in its
 * structural form — the two consumers name this value rather than each assembling
 * a table out of `RUN_COLUMNS` plus a noun they spell themselves.
 */
export const RUN_TABLE = {
  noun: 'run',
  columns: RUN_COLUMNS,
  emptyMessage: 'No runs for this project.',
} as const satisfies ListTable<RunRow, number>;

/**
 * The same run list on the TICKET DETAIL's Runs tab (BB-345 D7).
 *
 * One ticket's runs, so its empty message is the ticket's and not the project's
 * — and that one member is the whole difference. Declared as a second
 * configuration rather than re-admitting an `emptyMessage` parameter to the
 * renderer: the message is a property of the LIST, and a parameter would let the
 * two consumers drift on the members that must NOT differ (the columns, the
 * noun, and with the noun every row's node id) while looking like they only
 * differ on the one that may.
 */
export const TICKET_RUN_TABLE = {
  ...RUN_TABLE,
  emptyMessage: 'No runs for this ticket.',
} as const satisfies ListTable<RunRow, number>;

type RunColumnField = (typeof RUN_COLUMNS)[number]['fields'][number];

/**
 * The attributes a run row needs (BB-292 D2), in the order the query string
 * states them. `created` is a column field as `started_at`'s documented fallback
 * for a run that never started, and `heartbeat` + `claim_expires_at` ride the STATE
 * column because `deriveRunStatus` reads them.
 *
 * Membership is owned by the columns and proved exhaustive below; only the ORDER
 * is declared, because `tests/Entity/run/Data/query.test.ts` pins the emitted
 * `fields[bb_run--bb_run]=…` sequence and column order would hoist
 * `heartbeat`/`claim_expires_at` to third and fourth (BB-294, behaviour-neutral
 * to the bytes on the wire).
 */
export const RUN_LIST_ATTRIBUTES = [
  'drupal_internal__id',
  'state',
  'state_at_start',
  'agent',
  'started_at',
  'created',
  'heartbeat',
  'claim_expires_at',
  'closed',
] as const satisfies readonly RunListAttribute[];

/** Compile-time proof that the request above covers every column field — the half
 *  `satisfies` cannot check (it would accept a list that is merely too short). */
type AssertExhaustive<T extends true> = T;
type _RunRequestCoversEveryColumn = AssertExhaustive<
  Exclude<RunListAttribute, (typeof RUN_LIST_ATTRIBUTES)[number]> extends never
    ? true
    : false
>;

/** What `addFields('bb_run--bb_run', …)` takes. */
export const RUN_LIST_FIELDS: string[] = [
  ...RUN_LIST_ATTRIBUTES,
  ...RUN_LIST_RELATIONSHIPS,
];

/**
 * The sideloaded ticket renders ONE column: its identifier.
 *
 * Measured (BB-292 spec fact 4): without this, a 37-row run page shipped
 * 191.4 KB of `included` — 12 whole ticket resources with their descriptions —
 * out of 254.7 KB total, and took 4732 ms.
 */
export const RUN_TICKET_INCLUDE_FIELDS: string[] = ['identifier'];

/**
 * The conductor-scoped held-work table also names the ticket's title, so its
 * ticket include fieldset is wider than the project run list's — declared
 * separately so that list's own payload does not widen.
 */
export const CONDUCTOR_RUN_TICKET_INCLUDE_FIELDS: string[] = [
  'identifier',
  'title',
];

/**
 * The held-work table's columns: RUN, TICKET, TITLE, STATE, PHASE, STARTED.
 * AGENT is dropped — the conductor is constant on this page, and so is its
 * agent-per-run detail of little use here.
 */
export const CONDUCTOR_RUN_COLUMNS = [
  RUN_COLUMNS[0], // RUN
  RUN_COLUMNS[1], // TICKET
  {
    key: 'title',
    label: 'TITLE',
    width: 0,
    grow: 2,
    min: 24,
    fields: ['ticket_id'],
    get: (r: RunRow) => r.ticketTitle,
  },
  RUN_COLUMNS[2], // STATE
  RUN_COLUMNS[3], // PHASE
  RUN_COLUMNS[5], // STARTED
] as const satisfies readonly ListColumn<RunRow, number>[];

/** Held work: one conductor's non-terminal runs (BB-282-style table). */
export const CONDUCTOR_RUN_TABLE = {
  noun: 'run',
  columns: CONDUCTOR_RUN_COLUMNS,
  emptyMessage: 'This conductor holds no run.',
} as const satisfies ListTable<RunRow, number>;

/**
 * A key the list read really requests — derived from the columns since BB-294,
 * so removing a field from a column stops the mapper below compiling.
 */
type RunListAttribute =
  | Exclude<RunColumnField, RunListRelationship>
  | (typeof RUN_PREDICATE_ATTRIBUTES)[number];

/**
 * Map a RAW JSON:API `data[]` entry (from `client.get`) to a run row, resolving
 * the ticket identifier from the sideloaded includes indexed by id. Mirrors
 * `mapTicketData` — the only I/O is upstream in {@link loadProjectRuns}.
 *
 * Every attribute and relationship is read through an accessor keyed on the
 * fieldset, so reading one the list does not request is a compile error (AC-5).
 */
export function mapRunData(
  item: JsonApiResource,
  ticketsById: Map<string, JsonApiResource>,
): RunRow {
  const a = item.attributes ?? {};
  const text = (key: RunListAttribute): string | undefined =>
    typeof a[key] === 'string' ? (a[key] as string) : undefined;
  const raw = (key: RunListAttribute): unknown => a[key];
  const rel = (key: RunListRelationship) => item.relationships?.[key]?.data;

  const ticketRel = rel('ticket_id');
  const ticketId = Array.isArray(ticketRel)
    ? (ticketRel[0]?.id ?? null)
    : (ticketRel?.id ?? null);
  const ticket = ticketId ? ticketsById.get(ticketId) : undefined;
  const internal = raw('drupal_internal__id');
  const drupalId =
    typeof internal === 'number' || typeof internal === 'string'
      ? internal
      : null;
  return {
    id: item.id ?? '',
    drupalId,
    ticketId,
    ticketIdentifier:
      str(ticket?.attributes?.identifier) ?? (ticketId ? ticketId : '—'),
    ticketTitle: str(ticket?.attributes?.title) ?? '',
    state: text('state') ?? 'unknown',
    phase: text('state_at_start') ?? '—',
    agent: text('agent') ?? '—',
    startedAt: text('started_at') ?? text('created') ?? null,
    heartbeat: text('heartbeat') ?? null,
    claimExpiresAt: text('claim_expires_at') ?? null,
    closed:
      typeof raw('closed') === 'boolean' ? (raw('closed') as boolean) : false,
  };
}

/** One page of run rows plus whether another exists — the shared {@link Page},
 *  whose four members and their meaning are documented there (BB-294). */
export type RunPage = Page<RunRow>;

/**
 * List the `bb_run` entities of a project under the given criteria,
 * most-recently-started first — ONE page of them. The query (scope, include,
 * fieldsets, sort, closed filter) is built by {@link buildRunQueryParams}; the
 * page (size + index) is the caller's, and `hasNext` comes from the document's
 * `links.next`.
 */
export async function loadProjectRuns(
  client: DropshClient,
  projectId: string,
  criteria: RunCriteria,
  page = 0,
): Promise<RunPage> {
  // The window this read asks for, stated once and handed BOTH to the query
  // builder and to the page it produces, so the offset the screen positions with
  // is the offset the server was sent (BB-312 D3).
  const window: PageWindow = {
    offset: page * LIST_PAGE_SIZE,
    limit: LIST_PAGE_SIZE,
  };
  const params = buildRunQueryParams(projectId, criteria, {
    size: window.limit,
    index: page,
  });
  return loadPage(
    client,
    'bb_run/bb_run',
    params,
    (data, included) => {
      const ticketsById = new Map<string, JsonApiResource>();
      for (const inc of included) if (inc.id) ticketsById.set(inc.id, inc);
      return data.map((item) => mapRunData(item, ticketsById));
    },
    page,
    window,
  );
}

/** One page of runs attributed to a user via ticket assignee (BB-377 D2). */
export async function loadUserRuns(
  client: DropshClient,
  userId: string,
  criteria: RunCriteria,
  page = 0,
): Promise<RunPage> {
  const window: PageWindow = {
    offset: page * LIST_PAGE_SIZE,
    limit: LIST_PAGE_SIZE,
  };
  const params = buildUserRunQueryParams(userId, criteria, {
    size: window.limit,
    index: page,
  });
  return loadPage(
    client,
    'bb_run/bb_run',
    params,
    (data, included) => {
      const ticketsById = new Map<string, JsonApiResource>();
      for (const inc of included) if (inc.id) ticketsById.set(inc.id, inc);
      return data.map((item) => mapRunData(item, ticketsById));
    },
    page,
    window,
  );
}

/**
 * Newest-STARTED first, and TOTAL (BB-255 D5).
 *
 * `loadProjectRuns` gets its order from the server (`sort=-started_at`); the runs
 * a TICKET document sideloads arrive in whatever order the include produced, so
 * the ticket's Runs tab has to order them itself. Three keys applied in turn,
 * mirroring `compareCommentsNewestFirst`'s doctrine: `started_at` DESC (falling
 * back to `created`, as {@link mapRunData} does), then `drupal_internal__id` DESC
 * (the server's own monotonic key), then the resource `id` DESC.
 *
 * The third key is what makes it total rather than leaning on
 * `Array.prototype.sort` being stable: the order must be *deterministic* —
 * identical for the same runs in any input order — not merely "whatever the
 * include happened to send". A missing or unparseable start sorts LAST, so a
 * malformed row can never take the top slot and be the one Enter opens by default.
 */
export function compareRunsNewestFirst(
  a: JsonApiResource,
  b: JsonApiResource,
): number {
  const start = (r: JsonApiResource): number =>
    Date.parse(
      str(r.attributes?.started_at) ?? str(r.attributes?.created) ?? '',
    );
  const at = start(a);
  const bt = start(b);
  const aUnknown = Number.isNaN(at);
  const bUnknown = Number.isNaN(bt);
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  if (!aUnknown && at !== bt) return bt - at;

  const ai = Number(a.attributes?.drupal_internal__id);
  const bi = Number(b.attributes?.drupal_internal__id);
  if (!Number.isNaN(ai) && !Number.isNaN(bi) && ai !== bi) return bi - ai;

  // Code-unit comparison, not localeCompare: a locale-sensitive collation would
  // put the "deterministic" back in the hands of the runtime's locale data.
  const aid = a.id ?? '';
  const bid = b.id ?? '';
  return aid === bid ? 0 : aid < bid ? 1 : -1;
}

/**
 * The run rows of ONE ticket, read out of its detail document (BB-255 D5).
 *
 * No request: the ticket document already sideloads its `bb_run` includes with
 * the full attribute set (spec fact 5, re-measured on BB-255), and a second read
 * would be a second failure mode on a screen that is already loaded.
 *
 * The rows go through the same {@link mapRunData} the project-wide Runs screen
 * uses, so a run looks identical on both — one mapper, one table, no chance of the
 * two disagreeing about what a run is.
 *
 * It sorts the copy `filter` already allocated and NEVER `document.included`
 * itself: that array is mixed (runs *plus* comments, labels, the parent and the
 * assignment includes) and shared with those consumers, so an in-place sort would
 * be an invisible side effect on someone else's input.
 */
export function ticketRunRows(document: {
  data?: JsonApiResource;
  included?: JsonApiResource[];
}): RunRow[] {
  const ticketsById = new Map<string, JsonApiResource>();
  // The only ticket a sideloaded run can belong to is the document's own, and it
  // is right here — so the TICKET column resolves with no lookup table.
  if (document.data?.id) ticketsById.set(document.data.id, document.data);
  return (document.included ?? [])
    .filter((r) => r.type === 'bb_run--bb_run')
    .sort(compareRunsNewestFirst)
    .map((item) => mapRunData(item, ticketsById));
}

/** The selected run's ticket id, or null when out of range / ticket-less. */
export function selectedRunTicketId(
  rows: Pick<RunRow, 'ticketId'>[],
  index: number,
): string | null {
  return rows[index]?.ticketId ?? null;
}
