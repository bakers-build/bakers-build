import { expect, it } from 'vitest';
import { EMPTY_EDIT_FORM_OPTIONS } from '../../../../src/Entity/ticket/Form/edit.js';
import { loadEditFormOptions } from '../../../../src/Entity/ticket/Form/edit-data.js';
import { fakeClient, toResource } from '../../../test-support.js';

const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
const OTHER_PROJECT = 'pppppppp-0000-0000-0000-000000000002';
const LABEL = 'llllllll-0000-0000-0000-000000000001';

const user = (
  id: string,
  attrs: Record<string, unknown>,
  uid = 1,
): ReturnType<typeof toResource> =>
  toResource({
    id,
    type: 'user--user',
    attributes: { drupal_internal__uid: uid, ...attrs },
  });

const conductor = (
  id: string,
  attrs: Record<string, unknown>,
  project = PROJECT,
): ReturnType<typeof toResource> =>
  toResource({
    id,
    type: 'bb_conductor--bb_conductor',
    attributes: attrs,
    relationships: { project_id: { data: { id: project } } },
  });

const label = (
  id: string,
  attrs: Record<string, unknown>,
): ReturnType<typeof toResource> =>
  toResource({
    id,
    type: 'bb_term--label',
    attributes: attrs,
  });

const rows = () => ({
  user: [
    user('u0', { display_name: 'Anonymous', name: '' }, 0),
    user('u1', { display_name: 'cw', name: 'cw' }),
    user('u2', { display_name: 'tm', name: 'tm' }),
  ],
  bb_conductor: [
    conductor('c1', { label: 'cw-framework', status: 'running' }),
    conductor('c2', { label: 'tom', status: 'offline' }),
    conductor('c3', { label: 'elsewhere', status: 'running' }, OTHER_PROJECT),
  ],
  'bb_term/label': [
    label(LABEL, { name: 'work:code' }),
    label('llllllll-0000-0000-0000-000000000002', { name: 'work:docs' }),
  ],
  'bb_term/type': [
    toResource({
      id: 't1',
      type: 'bb_term--type',
      attributes: { name: 'bug' },
    }),
  ],
  'bb_term/recipe': [
    toResource({
      id: 'r1',
      type: 'bb_term--recipe',
      attributes: { name: 'drupal-bug' },
    }),
  ],
});

it('loads a reviewer bag distinct from the assignee bag', async () => {
  const write = fakeClient({
    rows: {
      ...rows(),
      bb_workspace: [
        toResource({
          id: 'wwwwwwww-0000-0000-0000-000000000001',
          type: 'bb_workspace--bb_workspace',
          attributes: { drupal_internal__id: 7 },
        }),
      ],
    },
    documents: {
      'user/user': {
        data: [
          {
            id: 'u1',
            type: 'user--user',
            attributes: { display_name: 'cw', drupal_internal__uid: 1 },
          },
          {
            id: 'u2',
            type: 'user--user',
            attributes: { display_name: 'tm', drupal_internal__uid: 2 },
          },
        ],
      },
      'og_membership/default': {
        data: [
          {
            relationships: {
              uid: { data: { id: 'u2' } },
              roles: { data: [] },
            },
          },
        ],
      },
    },
  });
  const opts = await loadEditFormOptions(
    { write, read: write },
    {
      projectId: PROJECT,
      workspaceId: 'wwwwwwww-0000-0000-0000-000000000001',
    },
  );
  expect(opts.users.map((u) => u.id)).toEqual(['u1', 'u2']);
  expect(opts.reviewers).toEqual([{ id: 'u2', label: 'tm' }]);
});

it('loads users + conductors through the WRITE client', async () => {
  const write = fakeClient({ rows: rows() });
  const read = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions(
    { write, read },
    { projectId: PROJECT },
  );

  expect(opts.users.map((u) => u.label)).toEqual(['cw', 'tm']);
  // The read client is never consulted while the write client answers — `pm`
  // sees the FULL conductor set and decides what a write may reference.
  // Terms ride the read client (they have no write-preferring helper).
  expect(read.collections).toEqual([
    'bb_term/type',
    'bb_term/recipe',
    'bb_term/label',
  ]);
  expect(write.collections.sort()).toEqual([
    'bb_conductor/bb_conductor',
    'user/user',
  ]);
});

it('AC-7: a throwing collection yields an empty list, the popup still opens', async () => {
  const write = fakeClient({
    rows: rows(),
    failingCollections: ['bb_conductor', 'user'],
  });
  const read = fakeClient({
    rows: rows(),
    failingCollections: ['bb_conductor', 'user', 'bb_term/label'],
  });
  const opts = await loadEditFormOptions(
    { write, read },
    { projectId: PROJECT },
  );
  expect(opts.users).toEqual([]);
  expect(opts.conductors).toEqual([]);
  expect(opts.labels).toEqual([]);
});

it('omits inactive conductors from the edit form options', async () => {
  const fixture = rows();
  fixture.bb_conductor.push(
    conductor('c4', { label: 'retired', status: 'offline', active: false }),
  );
  const options = await loadEditFormOptions(
    {
      write: fakeClient({ rows: fixture }),
      read: fakeClient({ rows: fixture }),
    },
    { projectId: PROJECT },
  );
  expect(options.conductors.map((option) => option.id)).not.toContain('c4');
});

it('AC-7: a failing WRITE list falls back to the read client, per list', async () => {
  const write = fakeClient({
    rows: rows(),
    failingCollections: ['bb_conductor'],
  });
  const read = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions(
    { write, read },
    { projectId: PROJECT },
  );
  // Conductors came from the fallback…
  expect(opts.conductors).toHaveLength(2);
  expect(read.collections.sort()).toEqual([
    'bb_conductor/bb_conductor',
    'bb_term/label',
    'bb_term/recipe',
    'bb_term/type',
  ]);
  // …while users still came from the write client (per-list, not all-or-nothing).
  expect(opts.users).toHaveLength(2);
});

it('with no write client it reads through the read client alone', async () => {
  const read = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions({ read }, { projectId: PROJECT });
  expect(opts.users).toHaveLength(2);
  expect(read.collections.sort()).toEqual([
    'bb_conductor/bb_conductor',
    'bb_term/label',
    'bb_term/recipe',
    'bb_term/type',
    'user/user',
  ]);
});

it('drops Anonymous (uid 0) — never a valid human assignee', async () => {
  const write = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions({ write, read: write });
  expect(opts.users.map((u) => u.id)).not.toContain('u0');
  expect(opts.users.map((u) => u.id)).toEqual(['u1', 'u2']);
});

it("filters conductors to the ticket's project (an out-of-project one is a certain 422)", async () => {
  const write = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions(
    { write, read: write },
    { projectId: PROJECT },
  );
  expect(opts.conductors.map((c) => c.id)).toEqual(['c1', 'c2']);
});

it('without a project id it offers every conductor', async () => {
  const write = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions({ write, read: write });
  expect(opts.conductors.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
});

it('a conductor label carries its liveness, so an offline one is visible', async () => {
  const write = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions(
    { write, read: write },
    { projectId: PROJECT },
  );
  expect(opts.conductors.map((c) => c.label)).toEqual([
    'cw-framework (running)',
    'tom (offline)',
  ]);
});

// ---- the edit popup's OWN policy (BB-236) ----------------------------------
//
// `users.ts` / `conductors.ts` are data services now: they return users and
// conductors, unfiltered and undecorated. Excluding Anonymous, filtering to the
// ticket's project and putting liveness in the label are THIS popup's rules, so
// the edge of each is asserted where the rule lives — here.

it('keeps a user whose uid never loaded — absent is not Anonymous', async () => {
  // The distinction the Anonymous filter rests on: `undefined` is not 0.
  const write = fakeClient({
    rows: {
      user: [
        toResource({
          id: 'u7',
          type: 'user--user',
          attributes: { display_name: 'ghost', name: 'ghost' },
        }),
      ],
    },
  });
  const opts = await loadEditFormOptions({ write, read: write });
  expect(opts.users.map((u) => u.id)).toEqual(['u7']);
});

it('filters to ANY given project, not just the one the fixture calls its own', async () => {
  const write = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions(
    { write, read: write },
    { projectId: OTHER_PROJECT },
  );
  expect(opts.conductors.map((c) => c.id)).toEqual(['c3']);
});

it('a conductor with no status gets a bare label — nothing to add, nothing added', async () => {
  const write = fakeClient({
    rows: { bb_conductor: [conductor('c9', { label: 'bare' })] },
  });
  const opts = await loadEditFormOptions({ write, read: write });
  expect(opts.conductors).toEqual([{ id: 'c9', label: 'bare' }]);
});

it('BB-360: the loaded bag carries labels from label and no stateTargets', async () => {
  const write = fakeClient({ rows: rows() });
  const read = fakeClient({ rows: rows() });
  const opts = await loadEditFormOptions(
    { write, read },
    { projectId: PROJECT },
  );
  expect(opts.labels.map((l) => l.id)).toEqual([
    LABEL,
    'llllllll-0000-0000-0000-000000000002',
  ]);
  expect(opts.labels.map((l) => l.label)).toEqual(['work:code', 'work:docs']);
  expect(opts).not.toHaveProperty('stateTargets');
  // BAKERS-17: Type and Recipe read their own vocabularies the same way.
  expect(opts.ticketTypes).toEqual([{ id: 't1', label: 'bug' }]);
  expect(opts.recipes).toEqual([{ id: 'r1', label: 'drupal-bug' }]);

  const broken = fakeClient({
    rows: rows(),
    failingCollections: [
      'bb_conductor',
      'user',
      'bb_term/label',
      'bb_term/type',
      'bb_term/recipe',
    ],
  });
  const failed = await loadEditFormOptions({ write: broken, read: broken });
  expect(failed.conductors).toEqual([]);
  expect(failed.labels).toEqual([]);
  expect(failed.ticketTypes).toEqual([]);
  expect(failed.recipes).toEqual([]);
  expect(failed).not.toHaveProperty('stateTargets');
});

it('BB-360: EMPTY_EDIT_FORM_OPTIONS has labels:[] and no stateTargets', () => {
  expect(EMPTY_EDIT_FORM_OPTIONS.labels).toEqual([]);
  expect(EMPTY_EDIT_FORM_OPTIONS.reviewers).toEqual([]);
  expect(EMPTY_EDIT_FORM_OPTIONS).not.toHaveProperty('stateTargets');
});
