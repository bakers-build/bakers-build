import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type {
  DropshClient,
  JsonApiRelationship,
  JsonApiResource,
} from '../../../types.js';
import {
  type JsonApiCollectionDoc,
  type ListTable,
  loadPage,
} from '../../collection.js';
import { type ListOutcome, messageOf } from '../../transport.js';

// BB-391 (AC4) — the `bb_team` collection read. The EIGHTH entity slice, and a
// clean G2 leaf: it reads two resources and imports nothing from another slice.
//
// It mirrors `Entity/project/Data/projects.ts` throughout: a `get` with an
// `include` rather than `collection().list()`, because the row needs a sideloaded
// relationship resolved into a name and the collection builder cannot ask for one.
//
// BB-321 fixed what a team IS, and this file is downstream of that: a team is
// the crew for reporting (`by_team` statistics), NOT an access carrier. So there
// is no membership editing here (that is BB-320) and no team filter on tickets
// — `bb_ticket` has no `team_id` at all, and a client-side
// team → og_membership → assignee expansion would build exactly the access
// carrier BB-321 decided against.

/**
 * Drupal JSON:API default page size (`OffsetPage::SIZE_MAX`), declared because
 * this read ASKS for it rather than letting the server apply it silently — the
 * Teams tab does not page further, and `page[limit]` bounds the QUERY, so the
 * bound has to be a number this file can name in its own chrome.
 */
export const TEAM_LIST_PAGE_SIZE = 50;

/** One page of `og_membership` rows, at the same server-imposed bound. */
export const MEMBERSHIP_PAGE_SIZE = 50;

/**
 * How many membership pages the count is allowed to walk before giving up.
 *
 * A BOUND rather than a while-true: this read runs on every draw of the Teams
 * tab, and `og_membership` is the one collection in this renderer whose size is
 * a property of the whole instance rather than of a screen. 20 pages is 1000
 * active `bb_team` memberships; past that the walk stops and the count is
 * reported as NOT COUNTED (`null`), never as the partial sum it reached — see
 * {@link countActiveMembersByTeam}.
 */
export const MEMBERSHIP_PAGE_CAP = 20;

/** What a team is, as this renderer needs it. */
export interface Team {
  /** The `bb_team` uuid — what a route param and a row node key on. */
  id: string;
  name: string;
  /**
   * `drupal_internal__id`, as a STRING.
   *
   * The one value `bb_team` and `og_membership` agree on. Membership has a
   * single system-wide mechanism (`og_membership`) whose `entity_id` is a plain
   * `string` base field holding the group's NUMERIC id, not its uuid — BB-321's
   * Fact 12, which is also why an `og_membership` is awkward to express as recipe
   * content. `undefined` when the document withheld it, which costs this team its
   * member count and nothing else.
   */
  internalId: string | undefined;
  /** The sideloaded `bb_workspace` name; `undefined` when unresolvable. */
  workspace: string | undefined;
}

/** One Teams-tab row: who the crew is, where it lives, how many are in it. */
export interface TeamListRow {
  id: string;
  name: string;
  /** Already formatted — `—` when the relationship did not resolve. */
  workspace: string;
  /**
   * Already formatted, and `—` for UNCOUNTED as opposed to `0` for counted-empty.
   * The distinction is the point: the membership read is the refusable one.
   */
  members: string;
}

/** How an unknown or uncountable value is shown, matching the ticket list's `—`. */
const EM_DASH = '—';

/**
 * The Teams list table — its columns, the noun every node id is prefixed with,
 * and what it says when there is nothing.
 */
export const TEAM_TABLE = {
  noun: 'team',
  emptyMessage: 'No teams.',
  columns: [
    {
      /**
       * FREE TEXT, and therefore the GROWER — the same trade the projects list
       * takes, for the same reason: a fixed width cuts an ordinary team name at
       * every terminal size, while a `width: 0` column declared FIRST takes the
       * row's surplus and leaves the two bounded columns their budgets.
       */
      key: 'name',
      label: 'TEAM',
      width: 0,
      fields: ['name'],
      get: (row: TeamListRow) => row.name,
    },
    {
      /** A workspace name is free text too, but it is not the row's subject, so
       *  it takes a budget and says when it was cut. */
      key: 'workspace',
      label: 'WORKSPACE',
      width: 20,
      fields: ['workspace_id'],
      get: (row: TeamListRow) => row.workspace,
    },
    {
      /**
       * A count and an em dash, so 8 columns show every value this can hold
       * whole — a DOMAIN constant read off the vocabulary, never a measurement of
       * the page.
       */
      key: 'members',
      label: 'MEMBERS',
      width: 8,
      // Not a `bb_team` field at all: it is counted from `og_membership`, and
      // saying so here is what keeps that a fact about this loader rather than a
      // hole in the column model.
      fields: [],
      get: (row: TeamListRow) => row.members,
    },
  ],
} as const satisfies ListTable<TeamListRow, void>;

/** Id of a single-valued relationship linkage (`data` object), or null. */
function singleRelId(rel: JsonApiRelationship | undefined): string | null {
  const data = rel?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

const str = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0) return value;
  // `drupal_internal__id` arrives as a NUMBER; `og_membership.entity_id` is a
  // string. One of the two has to be coerced, and coercing here is what keeps the
  // comparison in `countActiveMembersByTeam` a plain string equality.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

/**
 * The team collection read, as much of it as one page holds.
 *
 * `hasNext` is JSON:API's own `links.next` and the ONLY honest truncation
 * signal: the server caps a page at 50 rows whatever `page[limit]` asked for,
 * so `rows.length === TEAM_LIST_PAGE_SIZE` is exactly as consistent with "that
 * was all" as with "more follows" — it false-positives on an instance with
 * exactly 50 teams and false-negatives on nothing at all.
 */
export interface TeamCollection extends ListOutcome<Team> {
  hasNext: boolean;
}

/**
 * The team collection in server order, with each team's workspace name.
 *
 * Yields the OUTCOME rather than a swallowed array, for the reason BB-257 D4
 * gives: "there are no teams" and "the read was refused" are different answers,
 * and only the read knows which one happened. Read through `loadPage`, the ONE
 * page read this renderer has (BB-294), so the truncation signal is the same
 * `links.next` reading every other list uses rather than a second one here.
 */
export async function listTeams(client: DropshClient): Promise<TeamCollection> {
  const params = new DrupalJsonApiParams()
    .addInclude(['workspace_id'])
    .addPageLimit(TEAM_LIST_PAGE_SIZE);
  try {
    const page = await loadPage(
      client,
      'bb_team/bb_team',
      params,
      (data, included) => teamsFrom({ data, included }),
      0,
      { offset: 0, limit: TEAM_LIST_PAGE_SIZE },
    );
    return { rows: page.rows, hasNext: page.hasNext };
  } catch (caught) {
    return { rows: [], hasNext: false, error: messageOf(caught) };
  }
}

/** Map one `bb_team` collection document onto {@link Team} rows. */
export function teamsFrom(doc: JsonApiCollectionDoc): Team[] {
  const workspaceNameById = new Map<string, string>();
  for (const inc of doc.included ?? []) {
    const name = str(inc.attributes?.name);
    if (inc.id && name !== undefined) workspaceNameById.set(inc.id, name);
  }
  return (doc.data ?? []).map((resource) => {
    const id = resource.id ?? '';
    const workspaceId = singleRelId(resource.relationships?.workspace_id);
    return {
      id,
      // The uuid is the last honest fallback — nothing renders blank.
      name: str(resource.attributes?.name) ?? id,
      internalId: str(resource.attributes?.drupal_internal__id),
      workspace: workspaceId ? workspaceNameById.get(workspaceId) : undefined,
    };
  });
}

/** OG's own constant for an active membership (`OgMembershipInterface::STATE_ACTIVE`). */
export const MEMBERSHIP_STATE_ACTIVE = 'active';

/** The og_membership JSON:API resource, spelled once for both readers here. */
export const MEMBERSHIP_RESOURCE = 'og_membership/default';

/**
 * One page of `og_membership` rows, plus the two signals that end a walk.
 *
 * `withheld` is the one this renderer's shared `loadPage` cannot carry, and it is
 * the whole reason these two reads do not use it. A control plane that REFUSES a
 * membership read does not throw: JSON:API answers **HTTP 200 with `data: []` and
 * a `meta.omitted` block** naming each row it kept back (measured at BB-391 —
 * five rows omitted for two crews with five members between them). `loadPage`
 * reports `rows: []` for that, and an empty page is indistinguishable from an
 * empty collection — so the count came out as `0`, which by this file's contract
 * means COUNTED. A number nobody established is worse than the `—` that admits
 * it, because only one of the two can be acted on.
 */
export interface MembershipPage {
  rows: JsonApiResource[];
  /** JSON:API's `links.next`, the only honest end-of-collection signal. */
  hasNext: boolean;
  /** TRUE when the document carried `meta.omitted`: rows were WITHHELD. */
  withheld: boolean;
}

/** The og_membership document shape, as much of it as these two readers use. */
interface MembershipDoc {
  data?: JsonApiResource[];
  links?: { next?: unknown };
  /** `omitted` is the access-refusal block; `count` is BB-305's total. */
  meta?: { omitted?: unknown };
}

/**
 * Reads one page of `og_membership`, filtered as the caller asked.
 *
 * Shared by the Teams-list COUNT and the team-level ROSTER so the two cannot
 * disagree about what a refusal looks like, and so both send the same three
 * filters. Throws whatever the client throws: a transport failure and a withheld
 * page are different answers and each caller says so in its own vocabulary.
 *
 * @param client The dropsh client.
 * @param filters The `filter[…]` pairs to send beyond `state`.
 * @param offset The `page[offset]` to send; omitted when 0, as the first read is.
 */
export async function readMembershipPage(
  client: DropshClient,
  filters: Record<string, string>,
  offset: number,
): Promise<MembershipPage> {
  const params = new DrupalJsonApiParams()
    .addFilter('state', MEMBERSHIP_STATE_ACTIVE)
    .addSort('drupal_internal__id', 'ASC')
    .addPageLimit(MEMBERSHIP_PAGE_SIZE);
  for (const [field, value] of Object.entries(filters)) {
    params.addFilter(field, value);
  }
  if (offset > 0) params.addPageOffset(offset);

  const doc = (await client.get(MEMBERSHIP_RESOURCE, params)) as
    | MembershipDoc
    | undefined;

  return {
    rows: doc?.data ?? [],
    hasNext: Boolean(doc?.links?.next),
    // Presence is the signal, not its contents: the block is a `detail` string
    // and a `links` map whose shape is JSON:API's, not this client's.
    withheld: doc?.meta?.omitted !== undefined,
  };
}

/**
 * Active `bb_team` memberships, counted per INTERNAL team id.
 *
 * `null` — not an empty Map — when the count could not be COMPLETED, and that is
 * the whole contract of this function. An empty Map means "every team measured
 * zero members", which is a measurement an operator can act on; anything that
 * did not finish has measured nothing. The refusal is the likely case rather
 * than the exotic one: `og_membership` is OG's resource, not a bakers.build one, so
 * nothing in this project's rank model has an opinion about reading it.
 *
 * Both filters are load-bearing. Without `entity_type` the count would fold in
 * project and workspace memberships, which use the same table; without `state` it
 * would count pending and blocked people as crew.
 *
 * PAGED, and that is the second-round fix: the read used to send no
 * `page[limit]` at all and read `data` once. The control plane caps every page
 * at `OffsetPage::SIZE_MAX` regardless — `page[limit]` bounds the QUERY, not the
 * rows it returns — so past 50 active memberships the MEMBERS column showed a
 * number that was quietly a fraction of the crew. A wrong number is worse than
 * the `—` this file falls back to, because only one of the two admits it does
 * not know. The walk therefore follows `links.next`, the sole end-of-collection
 * signal, and gives up as `null` when it outruns {@link MEMBERSHIP_PAGE_CAP}
 * rather than returning the partial sum it had reached.
 *
 * A WITHHELD page is the third-round fix, and it is the one that was actually
 * biting. A refusal on this resource is not a throw: the control plane answered
 * HTTP 200 with `data: []` and a `meta.omitted` block, so the walk saw an empty
 * page, no `links.next`, and reported `0` for every crew — a NUMBER, which this
 * function's whole contract reserves for a measurement. BB-391's server half
 * makes the rows filtered rather than omitted, so a current deployment never
 * sends that shape; a deployment without the `bb:session:view_bb_memberships`
 * child scope still does, and it must read as `—`.
 */
export async function countActiveMembersByTeam(
  client: DropshClient,
): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  for (let index = 0; index < MEMBERSHIP_PAGE_CAP; index += 1) {
    let page: MembershipPage;
    try {
      page = await readMembershipPage(
        client,
        { entity_type: 'bb_team' },
        index * MEMBERSHIP_PAGE_SIZE,
      );
    } catch {
      // A refusal on ANY page, including a later one, leaves the count
      // incomplete — and an incomplete count is not a count.
      return null;
    }
    // Checked BEFORE the rows are folded in: a page that withheld some of its
    // rows and returned others would otherwise contribute a partial sum.
    if (page.withheld) return null;
    for (const row of page.rows) {
      const entityId = str(row.attributes?.entity_id);
      if (entityId === undefined) continue;
      counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
    }
    if (!page.hasNext) return counts;
  }
  return null;
}

/** Format one team's member count for a cell: `—` when it was never counted. */
export const formatMemberCount = (count: number | null): string =>
  count === null ? EM_DASH : String(count);

/**
 * What the Teams screen needs: the rows, whether the collection was refused, and
 * whether the server said more of it follows.
 *
 * The `error` is CARRIED rather than dropped, which is the second-round fix.
 * `listTeams` has always yielded a `ListOutcome` — a shape whose only purpose is
 * to tell a refused read from an empty collection (BB-257 D4) — and this loader
 * used to throw the `error` half away and return a bare array, so a 403 rendered
 * as `No teams.` and both the shape and the comment justifying it were decorative.
 * BB-391 D9 declines to rebuild this CLI's error handling in general; it does
 * not license discarding a distinction the code already carries.
 */
export interface TeamListResult {
  rows: TeamListRow[];
  /** Present only when the COLLECTION read failed; see {@link TeamCollection}. */
  error?: string;
  /** `links.next` on the collection page — never a row count. */
  hasNext: boolean;
}

/**
 * The Teams screen's rows: the collection and the membership count, read in
 * parallel because neither answer depends on the other.
 *
 * The two failures are deliberately NOT merged. A refused COLLECTION read has no
 * rows to show and the screen says so; a refused or incomplete MEMBERSHIP count
 * still has every team's identity and loses only the MEMBERS cell, which is what
 * the `—` says. Folding them into one flag would make the second look like the
 * first.
 */
export async function loadTeamRows({
  client,
}: {
  client: DropshClient;
}): Promise<TeamListResult> {
  const [teams, counts] = await Promise.all([
    listTeams(client),
    countActiveMembersByTeam(client),
  ]);
  return {
    rows: teams.rows.map((team) => ({
      id: team.id,
      name: team.name,
      workspace: team.workspace ?? EM_DASH,
      members: formatMemberCount(
        counts === null || team.internalId === undefined
          ? null
          : (counts.get(team.internalId) ?? 0),
      ),
    })),
    ...(teams.error === undefined ? {} : { error: teams.error }),
    hasNext: teams.hasNext,
  };
}
