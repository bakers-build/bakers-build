import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it } from 'vitest';
import {
  countActiveMembersByTeam,
  listTeams,
  loadTeamRows,
  MEMBERSHIP_PAGE_CAP,
  MEMBERSHIP_PAGE_SIZE,
  TEAM_LIST_PAGE_SIZE,
  TEAM_TABLE,
} from '../../../../src/Entity/team/Data/teams.js';
import type { DropshClient } from '../../../../src/types.js';

// BB-391 (AC4) — the `bb_team` collection read, mirroring
// `Entity/project/Data/projects.ts`: a sideloaded relationship resolved into a
// name, plus a second read the row cannot be built without.
//
// The MEMBER COUNT is the interesting half. `bb_team` carries no members
// field: membership is `og_membership`, whose `entity_id` is a plain STRING base
// field holding the group's NUMERIC id (BB-321's Fact 12), not its uuid. So the
// count keys on `drupal_internal__id` — the only value both resources agree on —
// and a team whose internal id the document withheld can have no count rather
// than a wrong one.
//
// That read is also the one most likely to be refused: OG ships no JSON:API
// access opinion of its own and `og_membership` is not a bakers.build resource type. A
// refusal therefore yields `null` — "not counted" — and never `0`, which would
// assert an empty crew the operator could act on.

/** A client answering per PATH, recording every path and its params. */
function fakeClient(byPath: Record<string, unknown>): {
  client: DropshClient;
  calls: { path: string; query: string }[];
} {
  const calls: { path: string; query: string }[] = [];
  const client: DropshClient = {
    get: async (path, params) => {
      calls.push({
        path,
        query: decodeURIComponent(
          (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
        ),
      });
      if (!(path in byPath)) throw new Error(`unexpected read: ${path}`);
      const answer = byPath[path];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    collection: () => ({}) as never,
    update: async () => ({}),
  };
  return { client, calls };
}

const TEAM_DOC = {
  data: [
    {
      id: 'team-uuid-1',
      attributes: { name: 'Platform', drupal_internal__id: 7 },
      relationships: { workspace_id: { data: { id: 'ws-1' } } },
    },
    {
      id: 'team-uuid-2',
      attributes: { name: 'Design', drupal_internal__id: 9 },
      relationships: { workspace_id: { data: { id: 'ws-1' } } },
    },
  ],
  included: [{ id: 'ws-1', attributes: { name: 'keytec' } }],
};

const MEMBERSHIP_DOC = {
  data: [
    { id: 'm1', attributes: { entity_id: '7' } },
    { id: 'm2', attributes: { entity_id: '7' } },
    { id: 'm3', attributes: { entity_id: '9' } },
  ],
};

const world = (over: Record<string, unknown> = {}) => ({
  'bb_team/bb_team': TEAM_DOC,
  'og_membership/default': MEMBERSHIP_DOC,
  ...over,
});

it('reads the team collection, sideloading the workspace name', async () => {
  const { client, calls } = fakeClient(world());
  const outcome = await listTeams(client);

  expect(calls[0]?.path).toBe('bb_team/bb_team');
  expect(calls[0]?.query).toContain('include=workspace_id');
  expect(outcome.error).toBeUndefined();
  expect(outcome.rows).toEqual([
    {
      id: 'team-uuid-1',
      name: 'Platform',
      internalId: '7',
      workspace: 'keytec',
    },
    { id: 'team-uuid-2', name: 'Design', internalId: '9', workspace: 'keytec' },
  ]);
});

it('bounds the collection read at the page size it documents', async () => {
  const { client, calls } = fakeClient(world());
  await listTeams(client);
  expect(calls[0]?.query).toContain(`page[limit]=${TEAM_LIST_PAGE_SIZE}`);
});

// The `error`/empty distinction the whole `ListOutcome` shape exists for: "there
// are no teams" and "the read failed" are different answers (BB-257 AC-4).
it('keeps the failure reason instead of reporting an empty crew list', async () => {
  const { client } = fakeClient({
    'bb_team/bb_team': new Error('403 Forbidden'),
  });
  const outcome = await listTeams(client);
  expect(outcome.rows).toEqual([]);
  expect(outcome.error).toContain('403 Forbidden');
});

it('counts ACTIVE bb_team memberships per internal team id', async () => {
  const { client, calls } = fakeClient(world());
  const counts = await countActiveMembersByTeam(client);

  const membershipCall = calls.find((c) => c.path === 'og_membership/default');
  expect(membershipCall).toBeDefined();
  // Both filters are load-bearing: without `entity_type` the count would include
  // project and workspace memberships, and without `state` it would count
  // pending and blocked people as crew.
  expect(membershipCall?.query).toContain('bb_team');
  expect(membershipCall?.query).toContain('active');
  expect(membershipCall?.query).toContain('sort=drupal_internal__id');
  expect(counts).toEqual(
    new Map([
      ['7', 2],
      ['9', 1],
    ]),
  );
});

// `null`, never an empty Map: an empty Map is "every team has zero members",
// which is a measurement. A refused read has not measured anything.
it('reports a refused membership read as null, never as zero members', async () => {
  const { client } = fakeClient(
    world({ 'og_membership/default': new Error('403 Forbidden') }),
  );
  expect(await countActiveMembersByTeam(client)).toBeNull();
});

it('builds rows carrying name, workspace and member count', async () => {
  const { client } = fakeClient(world());
  expect((await loadTeamRows({ client })).rows).toEqual([
    {
      id: 'team-uuid-1',
      name: 'Platform',
      workspace: 'keytec',
      members: '2',
    },
    { id: 'team-uuid-2', name: 'Design', workspace: 'keytec', members: '1' },
  ]);
});

it('renders an uncounted crew as an em dash, and a counted empty one as 0', async () => {
  const refused = fakeClient(
    world({ 'og_membership/default': new Error('403 Forbidden') }),
  );
  expect(
    (await loadTeamRows({ client: refused.client })).rows.map((r) => r.members),
  ).toEqual(['—', '—']);

  const counted = fakeClient(world({ 'og_membership/default': { data: [] } }));
  expect(
    (await loadTeamRows({ client: counted.client })).rows.map((r) => r.members),
  ).toEqual(['0', '0']);
});

it('survives a team whose workspace or internal id the document withheld', async () => {
  const { client } = fakeClient(
    world({
      'bb_team/bb_team': {
        data: [{ id: 'bare', attributes: {} }],
        included: [],
      },
    }),
  );
  expect((await loadTeamRows({ client })).rows).toEqual([
    { id: 'bare', name: 'bare', workspace: '—', members: '—' },
  ]);
});

// ---- BB-391 second round: the membership walk ---------------------------
//
// The control plane caps EVERY page at 50 rows whatever `page[limit]` asked for
// — `page[limit]` bounds the QUERY, not the returned rows — and `links.next` is
// the only end-of-collection signal there is. A single unpaged read therefore
// counted at most one page of memberships and reported the result as a NUMBER,
// which is the one thing this file's contract forbids: a number means counted.

/** A client answering a SEQUENCE of documents per path, recording the queries. */
function sequenceClient(byPath: Record<string, unknown[]>): {
  client: DropshClient;
  calls: { path: string; query: string }[];
} {
  const calls: { path: string; query: string }[] = [];
  const seen = new Map<string, number>();
  const client: DropshClient = {
    get: async (path, params) => {
      calls.push({
        path,
        query: decodeURIComponent(
          (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
        ),
      });
      const index = seen.get(path) ?? 0;
      seen.set(path, index + 1);
      const answers = byPath[path];
      if (!answers) throw new Error(`unexpected read: ${path}`);
      const answer = answers[Math.min(index, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    collection: () => ({}) as never,
    update: async () => ({}),
  };
  return { client, calls };
}

/** One membership page: `count` rows for `teamInternalId`, plus a next link. */
const membershipPage = (
  teamInternalId: string,
  count: number,
  hasNext: boolean,
) => ({
  data: Array.from({ length: count }, (_unused, index) => ({
    id: `m-${teamInternalId}-${index}`,
    attributes: { entity_id: teamInternalId },
  })),
  ...(hasNext ? { links: { next: { href: 'https://next' } } } : {}),
});

it('walks every membership page, so a crew past the page cap is counted whole', async () => {
  const { client, calls } = sequenceClient({
    'og_membership/default': [
      membershipPage('7', MEMBERSHIP_PAGE_SIZE, true),
      membershipPage('7', 3, false),
    ],
  });

  expect(await countActiveMembersByTeam(client)).toEqual(
    new Map([['7', MEMBERSHIP_PAGE_SIZE + 3]]),
  );
  // Two reads, the second offset by one page — `links.next` said so, and a
  // full page never does.
  expect(calls).toHaveLength(2);
  expect(calls[0]?.query).toContain(`page[limit]=${MEMBERSHIP_PAGE_SIZE}`);
  expect(calls[1]?.query).toContain(`page[offset]=${MEMBERSHIP_PAGE_SIZE}`);
});

it('stops at the first page the server does not follow with a next link', async () => {
  const { client, calls } = sequenceClient({
    'og_membership/default': [membershipPage('7', MEMBERSHIP_PAGE_SIZE, false)],
  });
  // Exactly one page of rows and no `links.next`: a FULL page is as consistent
  // with "that was all" as with "more follows", and the link is what decides.
  expect(await countActiveMembersByTeam(client)).toEqual(
    new Map([['7', MEMBERSHIP_PAGE_SIZE]]),
  );
  expect(calls).toHaveLength(1);
});

it('reports a walk that outruns its cap as uncounted, never as a partial count', async () => {
  const { client, calls } = sequenceClient({
    'og_membership/default': [membershipPage('7', MEMBERSHIP_PAGE_SIZE, true)],
  });
  // Every page carries `links.next`, so the walk never ends. A partial sum
  // rendered as a NUMBER would be worse than the `—` fallback, which is the
  // whole reason this function returns `null` rather than a best effort.
  expect(await countActiveMembersByTeam(client)).toBeNull();
  expect(calls).toHaveLength(MEMBERSHIP_PAGE_CAP);
});

it('reports a refusal on a LATER page as uncounted too', async () => {
  const { client } = sequenceClient({
    'og_membership/default': [
      membershipPage('7', MEMBERSHIP_PAGE_SIZE, true),
      new Error('403 Forbidden'),
    ],
  });
  expect(await countActiveMembersByTeam(client)).toBeNull();
});

// ---- BB-391 second round: the outcome the screen needs ------------------

it('carries the collection read’s refusal instead of dropping it', async () => {
  const { client } = fakeClient({
    'bb_team/bb_team': new Error('403 Forbidden'),
    'og_membership/default': MEMBERSHIP_DOC,
  });
  const result = await loadTeamRows({ client });
  expect(result.rows).toEqual([]);
  // The whole point of `listTeams` yielding a `ListOutcome`: a refused read and
  // an empty crew list are different answers, and the loader is the last place
  // that still knows which one happened.
  expect(result.error).toContain('403 Forbidden');
});

it('carries the collection’s own end-of-page signal, not a row count', async () => {
  const complete = fakeClient(world());
  expect((await loadTeamRows({ client: complete.client })).hasNext).toBe(false);

  const truncated = fakeClient(
    world({
      'bb_team/bb_team': {
        ...TEAM_DOC,
        links: { next: { href: 'https://next' } },
      },
    }),
  );
  expect((await loadTeamRows({ client: truncated.client })).hasNext).toBe(true);
});

it('declares the three columns the list is asked for, and the noun rows key on', () => {
  expect(TEAM_TABLE.noun).toBe('team');
  expect(TEAM_TABLE.columns.map((c) => c.label)).toEqual([
    'TEAM',
    'WORKSPACE',
    'MEMBERS',
  ]);
  // The name column is the GROWER, as on every other list: a fixed width cuts an
  // ordinary team name at every terminal size.
  expect(TEAM_TABLE.columns[0]?.width).toBe(0);
});

// ---- BB-391 third round: `meta.omitted` is UNCOUNTED, never zero ---------
//
// The failure this file's contract was written against, measured on a live
// control plane before the server half landed: `og_membership` was readable only
// on site-wide `administer organic groups` or an in-group `administer group` /
// `manage members` grant, and the bakers.build scope names none of them — so the
// collection answered **HTTP 200 with `data: []` and a `meta.omitted` block
// listing every withheld row**. Not a throw. `client.get` resolves, the walk
// sees an empty page and no `links.next`, and every team gets `counts.get(id) ??
// 0` — a NUMBER, which by this file's own contract means "counted". The Teams tab
// reported MEMBERS 0 for a crew of three.
//
// The server half (a query_access rule plus bakers.build's own access handler) makes the
// rows FILTERED rather than omitted, so a fixed deployment never sends this
// shape. These cases are for the ones that are not fixed yet: a control plane
// without the child scope `bb:session:view_bakers_memberships`, or with an older
// bb_core.

/** A 200 that WITHHELD its rows: the shape a refusing control plane sends. */
const omittedPage = () => ({
  data: [],
  meta: {
    omitted: {
      detail:
        'Some resources have been omitted because of insufficient authorization.',
      links: {
        help: {
          href: 'https://www.drupal.org/docs/8/modules/json-api/filtering',
        },
        'item--PDoQRhM': {
          href: 'https://example.test/jsonapi/og_membership/default/uuid-1',
        },
      },
    },
  },
});

it('reads a 200 that withheld its rows as UNCOUNTED, not as zero members', async () => {
  const { client } = fakeClient(
    world({ 'og_membership/default': omittedPage() }),
  );
  expect(await countActiveMembersByTeam(client)).toBeNull();
});

it('renders a withheld membership read as an em dash on every row', async () => {
  const { client } = fakeClient(
    world({ 'og_membership/default': omittedPage() }),
  );
  const result = await loadTeamRows({ client });
  expect(result.rows.map((r) => r.members)).toEqual(['—', '—']);
  // The COLLECTION read succeeded, so the screen still has both crews and says
  // nothing about a failure — only the MEMBERS cell admits it does not know.
  expect(result.error).toBeUndefined();
  expect(result.rows.map((r) => r.name)).toEqual(['Platform', 'Design']);
});

it('reads a withheld LATER page as uncounted too, never as the prefix it had', async () => {
  const { client } = sequenceClient({
    'og_membership/default': [
      membershipPage('7', MEMBERSHIP_PAGE_SIZE, true),
      omittedPage(),
    ],
  });
  expect(await countActiveMembersByTeam(client)).toBeNull();
});

// The distinction the two cases above exist to protect: `meta` WITHOUT `omitted`
// is an ordinary document, and an empty one of those is a real measurement.
it('still counts an empty page that merely carries a meta block', async () => {
  const { client } = fakeClient(
    world({ 'og_membership/default': { data: [], meta: { count: 0 } } }),
  );
  expect(await countActiveMembersByTeam(client)).toEqual(new Map());
});
