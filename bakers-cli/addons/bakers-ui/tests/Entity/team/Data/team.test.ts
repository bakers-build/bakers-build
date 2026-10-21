import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it } from 'vitest';
import { resolveTeam } from '../../../../src/Entity/team/Data/team.js';
import type { DropshClient } from '../../../../src/types.js';

// BB-391 (AC4) — ONE team, with its member count. The twin of
// `Entity/project/Data/project.ts`, which resolves one project's identity
// without reading anything the project owns; this one additionally carries the
// count, because the count is the only figure the team DETAIL has that the
// team-scoped statistics do not already serve.

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

const ONE_TEAM = {
  data: [
    {
      id: 'team-uuid-1',
      attributes: { name: 'Platform', drupal_internal__id: 7 },
      relationships: { workspace_id: { data: { id: 'ws-1' } } },
    },
  ],
  included: [{ id: 'ws-1', attributes: { name: 'keytec' } }],
};

it('resolves one team by uuid, with its workspace and member count', async () => {
  const { client, calls } = fakeClient({
    'bb_team/bb_team': ONE_TEAM,
    'og_membership/default': {
      data: [
        { id: 'm1', attributes: { entity_id: '7' } },
        { id: 'm2', attributes: { entity_id: '7' } },
      ],
    },
  });

  expect(await resolveTeam(client, 'team-uuid-1')).toEqual({
    id: 'team-uuid-1',
    name: 'Platform',
    workspace: 'keytec',
    members: 2,
  });
  // Filtered on the uuid, so the detail never pages the whole collection.
  expect(calls[0]?.query).toContain('team-uuid-1');
});

// The counting read is the refusable one, and a detail that could not count must
// say so rather than claim an empty crew.
it('reports members as null when the membership read is refused', async () => {
  const { client } = fakeClient({
    'bb_team/bb_team': ONE_TEAM,
    'og_membership/default': new Error('403 Forbidden'),
  });
  const team = await resolveTeam(client, 'team-uuid-1');
  expect(team.members).toBeNull();
  // …and the identity it DID read is still reported.
  expect(team.name).toBe('Platform');
});

// The uuid is the last honest fallback for a name, exactly as `resolveProject`
// falls back to the slug it was asked for — nothing renders blank.
it('falls back to the uuid when the team is not there', async () => {
  const { client } = fakeClient({
    'bb_team/bb_team': { data: [] },
    'og_membership/default': { data: [] },
  });
  expect(await resolveTeam(client, 'gone')).toEqual({
    id: 'gone',
    name: 'gone',
    workspace: undefined,
    members: null,
  });
});
