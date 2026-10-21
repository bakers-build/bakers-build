// The TICKET list read: the row type, the sideload-aware mapper and the
// server-side filtered list. Split out of `Service/project-data.ts` by BB-236
// phase 3 — that file carried a ticket half and a project half under a name that
// announced only the project. The project half is `project/Data/with-tickets.ts`.

import { asString } from '../../../lib/format.js';
import type {
  DropshClient,
  JsonApiRelationship,
  JsonApiResource,
} from '../../../types.js';
import {
  type ListColumn,
  type ListTable,
  loadPage,
  type Page,
  type PageWindow,
} from '../../collection.js';
import { LIST_PAGE_SIZE } from '../../cycle.js';
import {
  buildTeamMemberTicketQueryParams,
  buildTicketQueryParams,
  buildUserTicketQueryParams,
  type TicketCriteria,
} from './query.js';

/** One flat-table row derived from a `bb_ticket` dropsh resource. */
export interface TicketRow {
  id: string;
  identifier: string;
  title: string;
  state: string;
  priority: unknown;
  assigneeInitials: string;
  ownerInitials: string;
  derivedStatus: string;
  labels?: string[];
  type: string | null;
  /** Parent ticket identifier (`bakers.build-nnn`) from `parent_id`, else null (AC-1/2). */
  parent: string | null;
  /** Assigned conductor label from `conductor_id`, else null (AC-3/4). */
  conductor: string | null;
  /** Assignee uuid from the `assignee_user_id` linkage, else null (BB-299 D4). */
  assigneeId: string | null;
  /** Project uuid from the `project_id` linkage, else null (BB-540). */
  projectId: string | null;
  /** Boolean closed flag; an absent attribute reads as open (spec D5). */
  closed: boolean;
  /** Operator hold; an absent attribute reads as not frozen (BB-302). */
  frozen: boolean;
  /** Why the ticket is standing still: frozen|blocked|no conductor|failing, else ''. */
  stallReason: string;
}

/** A `(id) → resource` lookup over a document's sideloaded `included` entries.
 *  JSON:API ids are UUIDs (unique across bundles), so id alone keys uniquely. */
type IncludedIndex = Map<string, JsonApiResource>;

/** Build the {@link IncludedIndex} from a document's `included` array. */
function indexIncluded(included: JsonApiResource[] | undefined): IncludedIndex {
  const index: IncludedIndex = new Map();
  for (const r of included ?? []) if (r.id) index.set(r.id, r);
  return index;
}

/** Read the id of a single-valued relationship linkage (`data` object), or
 *  null when the linkage is absent, null, or an (unexpected) array. */
function singleRelId(rel: JsonApiRelationship | undefined): string | null {
  const data = rel?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

/**
 * The RELATIONSHIPS the row resolves through, and they belong in the fieldset.
 *
 * Still declared explicitly rather than derived from the column set, for two
 * reasons. The mapper's `rel()` accessor must accept relationship names and
 * REFUSE attribute names, which needs the two vocabularies kept apart; and
 * `tests/Entity/ticket/Data/tickets.test.ts` pins this exact ORDER, while column
 * order would emit `parent_id, conductor_id, labels`.
 *
 * Measured (BB-292 spec fact 5): a fieldset listing attributes only comes back
 * with `relationships: (none)` while `included` still arrives — the sideloaded
 * parent and conductor are present but nothing maps them to a row, so PARENT,
 * COND and the label suffix blank with no error at all.
 */
export const TICKET_LIST_RELATIONSHIPS = [
  'labels',
  'parent_id',
  'conductor_id',
  // No column renders it: the who filter's client-side guard compares
  // `TicketRow.assigneeId` (BB-299 D4), so the linkage must survive the
  // sparse fieldset exactly like the rendered ones. The project filter's
  // client-side guard (BB-540) needs `projectId` for the same reason.
  'assignee_user_id',
  'project_id',
] as const;
type TicketListRelationship = (typeof TICKET_LIST_RELATIONSHIPS)[number];

/**
 * Requested but rendered by NO column: `workflow` feeds `TicketRow.type` (the
 * row's workflow mapping, kept after BB-299 dropped the type filter) and
 * `closed` the closed predicate, so they are required and cannot be derived
 * from the column set.
 *
 * This is the declared half of BB-294's fieldset rule: the fieldset is the
 * columns' union PLUS this list, and this list is an explicit declaration rather
 * than an unstated remainder.
 */
const TICKET_PREDICATE_ATTRIBUTES = ['workflow', 'closed', 'frozen'] as const;

/**
 * The ticket list's columns — the header, the width, the cell value AND the
 * fieldset entry of each, in ONE declaration (BB-294 AC 4).
 *
 * `satisfies` types `get`'s parameter without constraining `fields` to the union
 * derived from it below, which would be circular.
 */
export const TICKET_COLUMNS = [
  {
    key: 'identifier',
    label: 'IDENTIFIER',
    width: 10,
    // An identifier is a project prefix plus a number, so 10 is a guess rather
    // than a domain constant: `ANERKENNUNGSPORTAL-123` painted `ANERKENNU…`
    // and lost exactly the number that tells two tickets apart (BB-549).
    // `parent` carries the same kind of value and fits for the same reason.
    fit: true,
    fields: ['identifier'],
    get: (r: TicketRow) => r.identifier,
  },
  {
    // BB-345 D3 — 13 is the length of `qualification`, the longest member of
    // the ticket workflow's state_flow, and therefore a DOMAIN constant rather
    // than a measurement of the page. The column is FIXED at it rather than
    // growing into it, and that is a correction to the spec's own sketch, made
    // on a measurement (see `lib/vnode.ts`): `cellText` places its ellipsis
    // against the width the column DECLARES, while a grown width is Yoga's
    // answer and is not knowable here. A column that grows from 8 towards 13
    // therefore still cuts its text at 8, and where it does not grow — a narrow
    // terminal — the renderer's own `truncate` cuts it SILENTLY (measured:
    // `qualification` at an 8-column budget paints `qualific`, no marker). A
    // fixed 13 shows every member of the vocabulary whole at 80, 120 and 160
    // alike, and any longer value keeps its `…`.
    key: 'state',
    label: 'STATE',
    width: 13,
    fields: ['state'],
    get: (r: TicketRow) => r.state,
  },
  {
    key: 'priority',
    label: 'PRIO',
    width: 5,
    fields: ['priority'],
    get: (r: TicketRow) => r.priority ?? '—',
  },
  {
    key: 'assignee',
    label: 'WHO',
    width: 4,
    fields: ['assignee_initials'],
    get: (r: TicketRow) => r.assigneeInitials || '—',
  },
  {
    // `BY` rather than `OWNER` because the column is four characters wide —
    // the same width the assignee's `WHO` uses for the same kind of value.
    // `cellText` cuts against the DECLARED width, so a longer label would be
    // truncated rather than shown.
    key: 'owner',
    label: 'BY',
    width: 4,
    fields: ['owner_initials'],
    get: (r: TicketRow) => r.ownerInitials || '—',
  },
  {
    key: 'run',
    label: 'RUN',
    width: 12,
    // `stall_reason` rides this column: BB-302 shows WHY a ticket is standing
    // still exactly where it would otherwise show what it is doing, so the two
    // share one cell and therefore one fieldset entry. Width 12 fits
    // `no conductor`, the longest operator-facing reason.
    fields: ['derived_status', 'stall_reason'],
    get: (r: TicketRow) => r.stallReason || r.derivedStatus,
  },
  {
    key: 'parent',
    label: 'PARENT',
    width: 10,
    fit: true,
    fields: ['parent_id'],
    get: (r: TicketRow) => r.parent ?? '—',
  },
  {
    key: 'conductor',
    label: 'COND',
    width: 14,
    fields: ['conductor_id'],
    get: (r: TicketRow) => r.conductor ?? '—',
  },
  {
    // The trailing column: unpadded, and it carries the label suffix.
    //
    // `grow: 3` is the share of the row's surplus this column claims. It is the
    // only grower the ticket list has — every other column is its vocabulary's
    // width — so in practice it claims all of it, which is what "the table uses
    // the width it is given" means once the fixed columns are sized to their
    // domains. Deliberately NO `min`: a floor here is a floor the row cannot
    // meet at 80 columns, where the fixed columns plus the gaps already take 71,
    // and an unmeetable minimum pushes the row past the right edge.
    key: 'title',
    label: 'TITLE',
    width: 0,
    grow: 3,
    fields: ['title', 'labels'],
    get: (r: TicketRow) =>
      `${r.title}${r.labels?.length ? `  [${r.labels.join(',')}]` : ''}`,
  },
] as const satisfies readonly ListColumn<TicketRow, void>[];

/**
 * The ticket list, declared once (BB-345 D2/D10): its columns, the noun every
 * one of its node ids is prefixed with and the footer counts in, and what it says
 * when it is empty.
 *
 * It lives HERE, beside the columns and the row mapper, because that is where the
 * fieldset proof below already binds the three together — a configuration in
 * `Screen/` would be a second place for a column set to disagree with its
 * request, and `tests/boundary.test.ts` G2 forbids this module `Screen/` anyway.
 */
export const TICKET_TABLE = {
  noun: 'ticket',
  columns: TICKET_COLUMNS,
  emptyMessage: 'No tickets.',
} as const satisfies ListTable<TicketRow, void>;

/**
 * The Assigned tab reuses the ticket table minus its COND column — the
 * conductor is constant on that page, so naming it in every row is noise.
 */
export const CONDUCTOR_TICKET_COLUMNS = [
  TICKET_COLUMNS[0], // IDENTIFIER
  TICKET_COLUMNS[1], // STATE
  TICKET_COLUMNS[2], // PRIO
  TICKET_COLUMNS[3], // WHO
  TICKET_COLUMNS[4], // RUN
  TICKET_COLUMNS[5], // PARENT
  TICKET_COLUMNS[7], // TITLE
] as const satisfies readonly ListColumn<TicketRow, void>[];

/** The tickets assigned to one conductor (Assigned tab). */
export const CONDUCTOR_TICKET_TABLE = {
  noun: 'ticket',
  columns: CONDUCTOR_TICKET_COLUMNS,
  emptyMessage: 'No ticket is assigned to this conductor.',
} as const satisfies ListTable<TicketRow, void>;

/** Every field any column is built from. */
type TicketColumnField = (typeof TICKET_COLUMNS)[number]['fields'][number];

/**
 * The ATTRIBUTES a ticket row needs, in the order the query string states them.
 *
 * The MEMBERSHIP is owned by the columns — every entry here must be a
 * `TicketListAttribute`, i.e. a field some column declares or a predicate-only
 * one, and `AssertExhaustive` below refuses to compile if the columns declare a
 * field this list forgot. So a column still cannot exist outside the request
 * (BB-294 AC 4) and removing a field from a column still breaks the mapper
 * (AC 5).
 *
 * The ORDER is declared rather than derived, because
 * `tests/Entity/ticket/Data/query.test.ts` pins the emitted
 * `fields[bb_ticket--bb_ticket]=…` sequence, and BB-294 is behaviour-neutral
 * down to the bytes on the wire. Column order would emit `title` last (it rides
 * the trailing TITLE column) instead of second.
 */
export const TICKET_LIST_ATTRIBUTES = [
  'identifier',
  'title',
  'state',
  'priority',
  'assignee_initials',
  'owner_initials',
  'derived_status',
  'stall_reason',
  'workflow',
  'closed',
  'frozen',
] as const satisfies readonly TicketListAttribute[];

/**
 * Compile-time proof that the request above covers every field the columns
 * declare — the half `satisfies` cannot check, since it only rejects entries that
 * are not attributes and would accept a list that is merely too short.
 */
type AssertExhaustive<T extends true> = T;
type _TicketRequestCoversEveryColumn = AssertExhaustive<
  Exclude<
    TicketListAttribute,
    (typeof TICKET_LIST_ATTRIBUTES)[number]
  > extends never
    ? true
    : false
>;

/** What `addFields('bb_ticket--bb_ticket', …)` takes. */
export const TICKET_LIST_FIELDS: string[] = [
  ...TICKET_LIST_ATTRIBUTES,
  ...TICKET_LIST_RELATIONSHIPS,
];

/** The sideloaded conductor renders one column: its label. */
export const TICKET_CONDUCTOR_INCLUDE_FIELDS: string[] = ['label'];

/**
 * A key the list read really requests. Reading anything else is a TYPE ERROR,
 * which is how "add a column, forget the fieldset" fails loudly (AC-5) — and since
 * BB-294 the union DERIVES from the columns, so removing a field from a column
 * stops the mapper below compiling.
 */
type TicketListAttribute =
  | Exclude<TicketColumnField, TicketListRelationship>
  | (typeof TICKET_PREDICATE_ATTRIBUTES)[number];

/** Map a RAW JSON:API `data[]` entry (from client.get) to a table row.
 *  `included` resolves the parent identifier + conductor label from the
 *  sideloaded relationships (AC-5); absent/unresolved → null (AC-2/4). */
export function mapTicketData(
  item: JsonApiResource,
  included?: IncludedIndex,
): TicketRow {
  const a = item.attributes ?? {};
  // Keyed on the fieldset, so `str('changed')` cannot compile until `changed` is
  // requested. The `??` fallbacks below still guard a genuinely ABSENT value —
  // a different thing from an unrequested one.
  const str = (key: TicketListAttribute): string | undefined =>
    typeof a[key] === 'string' ? (a[key] as string) : undefined;
  const raw = (key: TicketListAttribute): unknown => a[key];
  const rel = (key: TicketListRelationship): JsonApiRelationship | undefined =>
    item.relationships?.[key];

  const labelData = rel('labels')?.data;
  const labels = Array.isArray(labelData)
    ? labelData.map((l) => l.id).filter(Boolean)
    : labelData
      ? [labelData.id]
      : [];
  const index = included ?? new Map();
  const parentId = singleRelId(rel('parent_id'));
  const parent = parentId
    ? (asString(index.get(parentId)?.attributes?.identifier) ?? null)
    : null;
  const conductorId = singleRelId(rel('conductor_id'));
  const conductor = conductorId
    ? (asString(index.get(conductorId)?.attributes?.label) ?? null)
    : null;
  return {
    id: item.id ?? '',
    identifier: str('identifier') ?? item.id ?? '',
    title: str('title') ?? 'Untitled',
    state: str('state') ?? 'unknown',
    priority: raw('priority') ?? null,
    assigneeInitials: str('assignee_initials') ?? '',
    ownerInitials: str('owner_initials') ?? '',
    derivedStatus: str('derived_status') ?? 'idle',
    stallReason: str('stall_reason') ?? '',
    labels,
    type: str('workflow') ?? null,
    parent,
    conductor,
    assigneeId: singleRelId(rel('assignee_user_id')),
    projectId: singleRelId(rel('project_id')),
    closed:
      typeof raw('closed') === 'boolean' ? (raw('closed') as boolean) : false,
    frozen:
      typeof raw('frozen') === 'boolean' ? (raw('frozen') as boolean) : false,
  };
}

/**
 * Map a whole single-resource document (the shape `loadTicketDetail` returns)
 * to a table row — BB-252.
 *
 * The kernel needs this after an assignment save from the ticket list: the row
 * is rebuilt from the re-read the submit path already performs, so there is no
 * extra request, the selection cannot move, and there stays exactly ONE row
 * mapper. It takes a document rather than exposing `indexIncluded` and its
 * index type, which would leak this file's sideload mechanism into the caller;
 * the kernel says only *what* it wants, and how a row is built stays here.
 */
export function mapTicketDocument(document: {
  data?: JsonApiResource;
  included?: JsonApiResource[];
}): TicketRow {
  return mapTicketData(document.data ?? {}, indexIncluded(document.included));
}

/** One page of ticket rows plus whether another page exists — the shared
 *  {@link Page}, whose four members and their meaning are documented there
 *  (BB-294). */
export type TicketPage = Page<TicketRow>;

/**
 * How many tickets the criteria match once the `closed` criterion is DROPPED —
 * BB-370.
 *
 * The size of the COLLECTION, never of a page: it is the server's own
 * `meta.count` (BB-305), read off a one-row response, so an answer of 285 costs
 * the same single read as an answer of 1 and cannot be a recount of whatever the
 * screen happens to be holding. `null` when the server reports no count, which
 * `readTotal` already treats as the explicit unknown rather than as a zero.
 *
 * It builds the SAME query as {@link loadFilteredTickets} — the same `filter[search]` over
 * identifier/title, the same project/state/parent/who ANDs — with exactly one
 * criterion removed. That is what makes the number it returns an answer to "how
 * many is `closed` holding back" and not to some other question; a second,
 * hand-written query here could drift from the one the rows came from, and then
 * the count beside `No tickets.` would describe a different collection than the
 * emptiness it explains.
 *
 * `includes: false` and `page[limit]=1`: no row is mapped, so no sideload is worth
 * requesting.
 */
export async function countTicketsIgnoringClosed(
  client: DropshClient,
  projectId: string,
  criteria: TicketCriteria,
): Promise<number | null> {
  const params = buildTicketQueryParams(
    projectId,
    { ...criteria, closed: null },
    { page: { size: 1, index: 0 }, includes: false },
  );
  const page = await loadPage<never>(
    client,
    'bb_ticket/bb_ticket',
    params,
    () => [],
    0,
    { offset: 0, limit: 1 },
  );
  return page.total;
}

/** Server-side filtered/searched ticket list for a project — ONE page of it. The
 *  query sideloads `parent_id` + `conductor_id`; each row's parent/conductor is
 *  resolved from the document's `included` (AC-5). */
export async function loadFilteredTickets(
  client: DropshClient,
  projectId: string,
  criteria: TicketCriteria,
  page = 0,
): Promise<TicketPage> {
  // The window this read asks for, stated once and handed BOTH to the query
  // builder and to the page it produces, so the offset the screen positions with
  // is the offset the server was sent (BB-312 D3).
  const window: PageWindow = {
    offset: page * LIST_PAGE_SIZE,
    limit: LIST_PAGE_SIZE,
  };
  const params = buildTicketQueryParams(projectId, criteria, {
    page: { size: window.limit, index: page },
  });
  return loadPage(
    client,
    'bb_ticket/bb_ticket',
    params,
    (data, included) => {
      const index = indexIncluded(included);
      return data.map((item) => mapTicketData(item, index));
    },
    page,
    window,
  );
}

/**
 * BB-540 — the My work overload: `projectId === undefined && userId !== undefined`.
 *
 * The user ticket builder already pins `projectFromCriteria: true`, so
 * `criteria.project` becomes a filter when set (AC-2). When `projectId` is
 * undefined we pass that signal to the builder and it skips the project
 * filter (D1 of the original `buildUserTicketQueryParams`).
 */
export async function loadFilteredUserTickets(
  client: DropshClient,
  userId: string,
  criteria: TicketCriteria,
  page = 0,
): Promise<TicketPage> {
  const window: PageWindow = {
    offset: page * LIST_PAGE_SIZE,
    limit: LIST_PAGE_SIZE,
  };
  const params = buildUserTicketQueryParams(userId, criteria, {
    page: { size: window.limit, index: page },
  });
  return loadPage(
    client,
    'bb_ticket/bb_ticket',
    params,
    (data, included) => {
      const index = indexIncluded(included);
      return data.map((item) => mapTicketData(item, index));
    },
    page,
    window,
  );
}

/** One page of tickets assigned to a user (BB-377 D2). */
export async function loadUserTickets(
  client: DropshClient,
  userId: string,
  criteria: TicketCriteria,
  page = 0,
): Promise<TicketPage> {
  const window: PageWindow = {
    offset: page * LIST_PAGE_SIZE,
    limit: LIST_PAGE_SIZE,
  };
  const params = buildUserTicketQueryParams(userId, criteria, {
    page: { size: window.limit, index: page },
  });
  return loadPage(
    client,
    'bb_ticket/bb_ticket',
    params,
    (data, included) => {
      const index = indexIncluded(included);
      return data.map((item) => mapTicketData(item, index));
    },
    page,
    window,
  );
}

/** One page assigned to a member within a team's linked project set. */
export async function loadTeamMemberTickets(
  client: DropshClient,
  userId: string,
  projectIds: string[],
  criteria: TicketCriteria,
  page = 0,
): Promise<TicketPage> {
  if (projectIds.length === 0) {
    return { rows: [], hasNext: false, page, total: 0, window: null };
  }
  const window: PageWindow = {
    offset: page * LIST_PAGE_SIZE,
    limit: LIST_PAGE_SIZE,
  };
  const params = buildTeamMemberTicketQueryParams(
    userId,
    projectIds,
    criteria,
    { page: { size: window.limit, index: page } },
  );
  const result = await loadPage(
    client,
    'bb_ticket/bb_ticket',
    params,
    (data, included) => {
      const index = indexIncluded(included);
      return data.map((item) => mapTicketData(item, index));
    },
    page,
    window,
  );
  if (result.withheld) {
    throw new Error('the control plane withheld team member ticket rows');
  }
  return result;
}

/** Every open ticket assigned to one user, or an error instead of a prefix. */
export async function loadAllUserTickets(
  client: DropshClient,
  userId: string,
  criteria: TicketCriteria,
): Promise<TicketPage> {
  const rows: TicketRow[] = [];
  let pageIndex = 0;
  while (true) {
    const page = await loadUserTickets(client, userId, criteria, pageIndex);
    if (page.withheld) {
      throw new Error('the control plane withheld assigned ticket rows');
    }
    rows.push(...page.rows);
    if (!page.hasNext) {
      return {
        rows,
        hasNext: false,
        page: 0,
        total: rows.length,
        window: null,
      };
    }
    pageIndex += 1;
  }
}
