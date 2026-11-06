// BB-236 — the USER data service. It returns USERS and knows nothing about forms:
// no `Option`, no ordering, no filtering, no popup name. Whoever wants users shaped
// as picker rows says so itself — that is `create-form-data.ts` / `edit-form-data.ts`,
// and the boundary guard in `tests/boundary.test.ts` keeps this file on the data side
// of the line. The two read strategies are both just reading, so both live here.
import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type {
  DropshClient,
  JsonApiResource,
  Resource,
} from '../../../types.js';
import type { ListTable } from '../../collection.js';
import {
  type ListOutcome,
  listOutcome,
  listPreferringWrite,
  messageOf,
  type OptionClients,
} from '../../transport.js';

/**
 * Drupal JSON:API default page size (`OffsetPage::SIZE_MAX`).
 *
 * `listUsers` → `listOutcome` → `collection('user').list()` sends no
 * `page[limit]`, so the control plane applies this bound. The Users tab does
 * not page further.
 */
export const USER_LIST_PAGE_SIZE = 50;

/** One team-roster row: account label plus current assigned workload. */
export interface UserListRow {
  id: string;
  label: string;
  open: number;
  running: number;
  waiting: number;
}

/**
 * The Users list table — labels come from the user collection; the workload
 * numbers are filled by the screen (G2: Data/ stays a leaf).
 */
export const USER_TABLE = {
  noun: 'user',
  emptyMessage: 'No users.',
  columns: [
    {
      key: 'label',
      label: 'USER',
      width: 0,
      fields: ['display_name', 'name'],
      get: (r: UserListRow) => r.label,
    },
    {
      key: 'tickets',
      label: 'OPEN',
      width: 8,
      fields: [],
      get: (r: UserListRow) => String(r.open),
    },
    {
      key: 'runs',
      label: 'RUNNING',
      width: 10,
      fields: [],
      get: (r: UserListRow) => String(r.running),
    },
    {
      key: 'cpr',
      label: 'WAITING',
      width: 10,
      fields: [],
      get: (r: UserListRow) => String(r.waiting),
    },
  ],
} as const satisfies ListTable<UserListRow, void>;

/**
 * The SAME columns for one crew's member list (BB-391 AC4, second round).
 *
 * Only the wording differs, and the columns are shared rather than re-declared:
 * a crew's Users tab shows people, so a second column set would be two places
 * for one layout to drift. The noun keys the row node ids and the empty message
 * is the crew's own — `No users.` on a team page would read as an instance with
 * no accounts.
 */
export const TEAM_MEMBER_TABLE = {
  noun: 'member',
  emptyMessage: 'No active members in this crew.',
  columns: USER_TABLE.columns,
} as const satisfies ListTable<UserListRow, void>;

/** One user of the control plane, as this renderer needs it. */
export interface User {
  id: string;
  /** Never empty — the uuid is the last fallback, so nothing renders as blank. */
  label: string;
  /** Username. */
  name: string | undefined;
  /** `drupal_internal__uid`; 0 is Drupal's Anonymous. Absent ⇒ `undefined`, NOT 0. */
  uid: number | undefined;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

// The ONE attribute-level mapping both reads share — the Resource-wrapped
// collection list and the Who candidate read's raw JSON:API rows — so the
// label policy (`display_name ?? name ?? uuid`) and the uid typing cannot
// drift between the two (BB-299 F6).
const fromAttributes = (id: string, attr: (key: string) => unknown): User => {
  const uid = attr('drupal_internal__uid');
  return {
    id,
    label: str(attr('display_name')) ?? str(attr('name')) ?? id,
    name: str(attr('name')),
    uid: typeof uid === 'number' ? uid : undefined,
  };
};

const toUser = (r: Resource): User => fromAttributes(r.id, (k) => r.attr(k));

/**
 * The user collection through one client, in server order.
 *
 * Yields the OUTCOME rather than a swallowed array (BB-257 D4), for the same
 * reason `listTerms` does: the create popup has to be able to say that the read
 * failed instead of presenting an empty Assignee ring, and only the read knows
 * why it failed. `listUsersPreferringWrite` keeps the swallowing contract — it
 * already HAS an answer to a failure (fall back to the read client), which is
 * the case D4 says the best-effort rule is right for.
 */
export const listUsers = (client: DropshClient): Promise<ListOutcome<User>> =>
  listOutcome(client, 'user', toUser);

/** Every readable user, walking JSON:API pages to completion. */
export async function listAllUsers(
  client: DropshClient,
): Promise<ListOutcome<User>> {
  const rows: User[] = [];
  let offset = 0;
  try {
    while (true) {
      const params = new DrupalJsonApiParams()
        // user/user serialises the entity id as drupal_internal__uid.
        .addSort('drupal_internal__uid', 'ASC')
        .addPageLimit(USER_LIST_PAGE_SIZE);
      if (offset > 0) params.addPageOffset(offset);
      const doc = (await client.get('user/user', params)) as {
        data?: JsonApiResource[];
        links?: { next?: unknown };
        meta?: { omitted?: unknown };
      };
      if (doc?.meta?.omitted !== undefined) {
        throw new Error('the control plane withheld user rows (meta.omitted)');
      }
      rows.push(
        ...(doc?.data ?? []).map((resource) =>
          fromAttributes(
            resource.id ?? '',
            (key) => resource.attributes?.[key],
          ),
        ),
      );
      if (!doc?.links?.next) return { rows };
      offset += USER_LIST_PAGE_SIZE;
    }
  } catch (caught) {
    return { rows: [], error: messageOf(caught) };
  }
}

/**
 * The same collection read through the WRITE client where there is one — still just
 * reading, but the write scope is the one that decides what a write may reference,
 * and `pm` sees more than `session` does.
 */
export const listUsersPreferringWrite = (
  clients: OptionClients,
): Promise<User[]> => listPreferringWrite(clients, 'user', toUser);

/** A user the Who picker may offer: the uuid to filter by plus the label to show. */
export interface WhoCandidate {
  id: string;
  label: string;
  uid: number | undefined;
}

/** One page of candidates per Who query. */
export const WHO_PAGE_SIZE = 50;

/**
 * The Who picker's candidate read (BB-299 D5): users whose NAME contains the
 * typed fragment — `display_name` is a computed field, so JSON:API cannot
 * filter on it; matching is name-only while the label shows the display name
 * (spec F6, disclosed limitation R4). uid 0 is dropped here, at the one place
 * every Who consumer reads through — Anonymous is never a valid assignee (the
 * `edit-data.ts` rule).
 *
 * Takes NO criteria: the candidate read never sees the filter it feeds (the
 * parent filter's F7, applied).
 */
/** The one read both Who queries share: a page of `user/user`, uid 0 dropped. */
async function fetchWhoCandidates(
  client: DropshClient,
  params: DrupalJsonApiParams,
): Promise<ListOutcome<WhoCandidate>> {
  try {
    const doc = (await client.get('user/user', params)) as {
      data?: JsonApiResource[];
    };
    const rows = (doc?.data ?? [])
      .map((r) => fromAttributes(r.id ?? '', (key) => r.attributes?.[key]))
      .filter((u) => u.uid !== 0);
    return {
      rows: rows.map((u) => ({ id: u.id, label: u.label, uid: u.uid })),
    };
  } catch (caught) {
    return { rows: [], error: messageOf(caught) };
  }
}

export async function loadWhoCandidates(
  client: DropshClient,
  query: string,
): Promise<ListOutcome<WhoCandidate>> {
  const params = new DrupalJsonApiParams();
  if (query) params.addFilter('name', query, 'CONTAINS');
  params.addPageLimit(WHO_PAGE_SIZE);
  return fetchWhoCandidates(client, params);
}

/**
 * Resolve a username to the Who criterion's candidate (BB-287 D4) — an EXACT
 * `name` match. The mine toggle filters tickets on the resolved uuid, so a
 * CONTAINS hit on a longer sibling name would filter on the wrong user:
 * identity must be proven, not guessed. At most one row comes back (Drupal
 * names are unique); uid 0 is dropped by the shared read.
 */
export async function resolveWhoCandidate(
  client: DropshClient,
  name: string,
): Promise<ListOutcome<WhoCandidate>> {
  const params = new DrupalJsonApiParams();
  params.addFilter('name', name);
  params.addPageLimit(WHO_PAGE_SIZE);
  const outcome = await fetchWhoCandidates(client, params);
  return { ...outcome, rows: outcome.rows.slice(0, 1) };
}
