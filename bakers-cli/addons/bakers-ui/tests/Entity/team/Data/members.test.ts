import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it } from 'vitest';
import { listTeamMemberIds } from '../../../../src/Entity/team/Data/members.js';
import { MEMBERSHIP_PAGE_CAP } from '../../../../src/Entity/team/Data/teams.js';
import type { DropshClient } from '../../../../src/types.js';

// BB-391 AC4 (second round) — WHO is in one crew.
//
// The team level's Users tab needs the membership itself, not a count: the Teams
// list already counts, and a crew member who closed nothing this month would be
// missing from any list derived from the statistics document. So the crew is read
// from `og_membership` and the PEOPLE are resolved by whoever renders them — this
// module returns uuids and nothing else, because `Entity/*/Data/` may not reach
// into another slice (boundary G2) and `user` is another slice.
//
// The join goes through `drupal_internal__id`: `og_membership.entity_id` is a
// plain STRING base field holding the group's NUMERIC id (BB-321 Fact 12), so
// the routed uuid has to be resolved to that number first. A team whose internal
// id the document withheld therefore has NO member list rather than an empty one.

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

const TEAM_DOC = {
  data: [
    {
      id: 'team-uuid-1',
      attributes: { name: 'Platform', drupal_internal__id: 7 },
    },
  ],
};

/** One membership page whose rows point at `users`, plus an optional next link. */
const membershipPage = (users: string[], hasNext = false) => ({
  data: users.map((uuid, index) => ({
    id: `m-${index}`,
    attributes: { entity_id: '7' },
    relationships: { uid: { data: { type: 'user--user', id: uuid } } },
  })),
  ...(hasNext ? { links: { next: { href: 'https://next' } } } : {}),
});

it('resolves the routed uuid to the internal id the membership table joins on', async () => {
  const { client, calls } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [membershipPage(['user-a', 'user-b'])],
  });

  expect(await listTeamMemberIds(client, 'team-uuid-1')).toEqual({
    ids: ['user-a', 'user-b'],
  });
  expect(calls[0]?.query).toContain('filter[id]=team-uuid-1');
  // Three filters, all load-bearing: `entity_type` keeps project and workspace
  // memberships (same table) out, `entity_id` narrows to THIS crew, and `state`
  // keeps pending and blocked people from counting as crew.
  const membership = calls.find((c) => c.path === 'og_membership/default');
  expect(membership?.query).toContain('bb_team');
  expect(membership?.query).toContain('filter[entity_id]=7');
  expect(membership?.query).toContain('active');
});

it('walks every membership page, so a crew past the page cap is listed whole', async () => {
  const first = Array.from({ length: 50 }, (_u, i) => `user-${i}`);
  const { client } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [
      membershipPage(first, true),
      membershipPage(['user-50']),
    ],
  });

  const result = await listTeamMemberIds(client, 'team-uuid-1');
  expect(result.ids).toHaveLength(51);
  expect(result.ids?.at(-1)).toBe('user-50');
});

it('reports a walk that outruns its cap as NOT established, never as a short crew', async () => {
  const { client, calls } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [membershipPage(['user-a'], true)],
  });

  const result = await listTeamMemberIds(client, 'team-uuid-1');
  expect(result.ids).toBeNull();
  expect(result.error).toBeDefined();
  expect(calls.filter((c) => c.path === 'og_membership/default')).toHaveLength(
    MEMBERSHIP_PAGE_CAP,
  );
});

it('reports a refused membership read as NOT established, never as an empty crew', async () => {
  const { client } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [new Error('403 Forbidden')],
  });
  const result = await listTeamMemberIds(client, 'team-uuid-1');
  expect(result.ids).toBeNull();
  expect(result.error).toContain('403 Forbidden');
});

it('reports a team it cannot resolve, rather than reading every membership', async () => {
  const { client, calls } = sequenceClient({
    'bb_team/bb_team': [{ data: [] }],
    'og_membership/default': [membershipPage(['user-a'])],
  });
  const result = await listTeamMemberIds(client, 'gone');
  expect(result.ids).toBeNull();
  expect(result.error).toBeDefined();
  // No `entity_id` to filter by means no honest query — so none is sent, rather
  // than one that would count every bb_team membership on the instance.
  expect(calls.map((c) => c.path)).toEqual(['bb_team/bb_team']);
});

// A counted-empty crew is a real answer an operator can act on ("nobody is in
// this team"), and it is NOT the same answer as "the membership read failed".
it('distinguishes a crew with no members from a crew it could not read', async () => {
  const { client } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [membershipPage([])],
  });
  expect(await listTeamMemberIds(client, 'team-uuid-1')).toEqual({ ids: [] });
});

it('skips a membership row that names no user, instead of inventing one', async () => {
  const { client } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [
      {
        data: [
          { id: 'm0', attributes: { entity_id: '7' } },
          {
            id: 'm1',
            attributes: { entity_id: '7' },
            relationships: { uid: { data: { id: 'user-a' } } },
          },
        ],
      },
    ],
  });
  expect((await listTeamMemberIds(client, 'team-uuid-1')).ids).toEqual([
    'user-a',
  ]);
});

// ---- BB-391 third round: the two facts, verified against a live server ----
//
// Both were inferences the previous round could not check. Measured on a running
// control plane (`ddev drush` on the JSON:API resource type, then a real token
// read):
//
//   * `uid` is published as a RELATIONSHIP under exactly that public name
//     (`ResourceTypeRelationship`, public name `uid`), so
//     `relationships.uid.data.id` is right. `entity_id` and `state` are
//     ATTRIBUTES, and `type` is published as `og_membership_type` — which is why
//     nothing here reads it.
//   * `filter[entity_id]` resolves: a read filtered on `entity_id=1` returned
//     exactly the three rows of that crew and no 400.
//
// And the failure mode neither of them covers: a control plane that still
// REFUSES the read answers HTTP 200 with `data: []` and a `meta.omitted` block
// rather than throwing, so the walk below would report an EMPTY crew — a real
// answer an operator can act on — for one it was not allowed to see.

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

it('reads a 200 that withheld its rows as NOT established, not as an empty crew', async () => {
  const { client } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [omittedPage()],
  });
  const result = await listTeamMemberIds(client, 'team-uuid-1');
  expect(result.ids).toBeNull();
  expect(result.error).toBeDefined();
});

it('reads a withheld LATER page as not established too', async () => {
  const first = Array.from({ length: 50 }, (_u, i) => `user-${i}`);
  const { client } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [membershipPage(first, true), omittedPage()],
  });
  const result = await listTeamMemberIds(client, 'team-uuid-1');
  expect(result.ids).toBeNull();
  expect(result.error).toBeDefined();
});

it('reads the member from the relationship name the server really publishes', async () => {
  const { client } = sequenceClient({
    'bb_team/bb_team': [TEAM_DOC],
    'og_membership/default': [
      {
        data: [
          {
            id: 'm0',
            attributes: { entity_id: '7', state: 'active' },
            relationships: {
              // The three relationships a real row carries. Only `uid` names the
              // member; `og_membership_type` is the bundle and `roles` the rank,
              // and reading either as the member would put a bundle uuid in the
              // crew list.
              og_membership_type: { data: { id: 'bundle-uuid' } },
              roles: { data: [] },
              uid: { data: { type: 'user--user', id: 'user-a' } },
            },
          },
        ],
      },
    ],
  });
  expect((await listTeamMemberIds(client, 'team-uuid-1')).ids).toEqual([
    'user-a',
  ]);
});
