import { expect, it } from 'vitest';
import { loadCreateFormOptions } from '../../../../src/Entity/ticket/Form/create-data.js';
import type { DropshClient, Resource } from '../../../../src/types.js';
import { fakeClient, toResource } from '../../../test-support.js';

// BB-257 D12 — this file used to carry its OWN client double, keyed by the exact
// string handed to `collection()`. That is the second copy of the laxity F2b names:
// a fixture keyed `bb_term` answered a request for a bundle that does not exist.
// It reads through the shared `fakeClient` now, which resolves a spec the way dropsh
// does, so the vocabulary this popup asks for has to be named here too.

const res = (id: string, attrs: Record<string, unknown>): Resource =>
  toResource({ id, type: 't--t', attributes: attrs });

/** The bundle this popup offers as its labels (D3) — the fixture key it needs. */
const LABELS = 'bb_term/bb_labels';

it('preselects the own user (by name) and own conductor (by machine_id)', async () => {
  const client = fakeClient({
    rows: {
      user: [res('u1', { name: 'other' }), res('u2', { name: 'cw' })],
      bb_conductor: [
        res('c1', { machine_id: 'm1', label: 'one' }),
        res('c2', { machine_id: 'mine', label: 'mine' }),
      ],
      [LABELS]: [res('l1', { name: 'bug' })],
    },
  });
  const opts = await loadCreateFormOptions(client, {
    currentUser: 'cw',
    ownConductorMachineId: 'mine',
    // BB-664 F4: the conductor source needs a project in scope now.
    projectId: 'p1',
  });
  expect(opts.users[0]?.id).toBe('u2'); // own user first
  expect(opts.conductors[0]?.id).toBe('c2'); // own conductor first
  expect(opts.labels[0]?.label).toBe('bug');
  expect(opts.workflows.map((w) => w.id)).toContain('bb_feature');
});

it('without hints keeps server order; a failing query yields an empty list', async () => {
  const client: DropshClient = {
    get: async () => ({}),
    collection: () =>
      ({
        where() {
          return this;
        },
        sort() {
          return this;
        },
        page() {
          return this;
        },
        first: async () => null,
        list: async () => {
          throw new Error('permission denied');
        },
      }) as never,
  };
  const opts = await loadCreateFormOptions(client);
  expect(opts.users).toEqual([]);
  expect(opts.conductors).toEqual([]);
  expect(opts.workflows.length).toBeGreaterThan(0); // fixed enum survives
});

// ---- the create popup's OWN policy (BB-236) --------------------------------
//
// `users.ts` / `conductors.ts` / `terms.ts` are data services now: they return
// users, conductors and terms, in server order, with no policy at all. Own-first
// and the mapping to `{id, label}` are THIS popup's rules, so they are asserted
// where they live — here.

it('own-first matches the machine`s user by UUID too, not only by username', async () => {
  const client = fakeClient({
    rows: {
      user: [
        res('u0', { display_name: 'Anonymous', name: '' }),
        res('u1', { name: 'other' }),
        res('u2', { name: 'cw' }),
      ],
    },
  });
  // The launcher may know the user either way; both count as "own".
  expect(
    (await loadCreateFormOptions(client, { currentUser: 'u1' })).users.map(
      (u) => u.id,
    ),
  ).toEqual(['u1', 'u0', 'u2']);
  // Stable partition: everything else keeps the server's order behind it.
  expect(
    (await loadCreateFormOptions(client, { currentUser: 'cw' })).users.map(
      (u) => u.id,
    ),
  ).toEqual(['u2', 'u0', 'u1']);
});

it('own-first orders conductors by machine_id and leaves the rest in server order', async () => {
  const client = fakeClient({
    rows: {
      bb_conductor: [
        res('c1', { machine_id: 'm1', label: 'one' }),
        res('c2', { machine_id: 'mine', label: 'mine' }),
        res('c3', { machine_id: 'm3', label: 'three' }),
      ],
    },
  });
  expect(
    (
      await loadCreateFormOptions(client, {
        ownConductorMachineId: 'mine',
        projectId: 'p1',
      })
    ).conductors.map((c) => c.id),
  ).toEqual(['c2', 'c1', 'c3']);
  // No reordering hint, same project — server order.
  expect(
    (await loadCreateFormOptions(client, { projectId: 'p1' })).conductors.map(
      (c) => c.id,
    ),
  ).toEqual(['c1', 'c2', 'c3']);
});

it('D16 (BB-664 F4): without a project id the conductor ring is empty, not every conductor', async () => {
  const client = fakeClient({
    rows: { bb_conductor: [res('c1', { machine_id: 'm1', label: 'one' })] },
  });
  const opts = await loadCreateFormOptions(client);
  expect(opts.conductors).toEqual([]);
  expect(opts.errors?.conductors).toBeUndefined();
});

// BB-664 AC-8 — the Project field's own source.

it('without a project id the popup ALSO offers a `projects` bag to search, not a refusal', async () => {
  const client = fakeClient({ rows: {} });
  const opts = await loadCreateFormOptions(client);
  // Primed with the empty query (AC-3's 2-character gate), so it opens empty —
  // present, not absent, which is what lets the field be typed into at all.
  expect(opts.projects).toEqual([]);
});

it('WITH a project id there is no `projects` source — the field does not exist', async () => {
  const client = fakeClient({ rows: {} });
  const opts = await loadCreateFormOptions(client, { projectId: 'p1' });
  expect(opts.projects).toBeUndefined();
});

it('omits inactive conductors from the create form options', async () => {
  const client = fakeClient({
    rows: {
      bb_conductor: [
        res('active', { label: 'Active', active: true }),
        res('inactive', { label: 'Inactive', active: false }),
      ],
    },
  });
  const options = await loadCreateFormOptions(client, { projectId: 'p1' });
  expect(options.conductors.map((option) => option.id)).toEqual(['active']);
});

it('every option is a PLAIN `{id, label}` — no status suffix, nothing else', async () => {
  // Measured live: the create ring shows `cw-framework`, not `cw-framework
  // (running)`. The `(status)` label is the EDIT popup's rule and must not leak.
  const client = fakeClient({
    rows: {
      user: [res('u1', { display_name: 'cw', name: 'cw' })],
      bb_conductor: [
        res('c1', {
          label: 'cw-framework',
          status: 'running',
          machine_id: 'm1',
        }),
      ],
      [LABELS]: [res('t1', { name: 'bug' })],
    },
  });
  const opts = await loadCreateFormOptions(client, { projectId: 'p1' });
  expect(opts.conductors).toEqual([{ id: 'c1', label: 'cw-framework' }]);
  expect(Object.keys(opts.users[0] ?? {}).sort()).toEqual(['id', 'label']);
  expect(opts.labels).toEqual([{ id: 't1', label: 'bug' }]);
});

// ---- BB-257 AC-3 / AC-4: the vocabulary, and a failure that is sayable ------

it('AC-3 (D3): the labels bag is read from the `bb_labels` vocabulary', async () => {
  // The POLICY "this popup offers bb_labels" lives here, in the adapter, beside
  // every other create-popup policy — not in the data service, which stays
  // entity-named and form-ignorant (the boundary guard asserts it never imports
  // `Form/`).
  const client = fakeClient({
    rows: { [LABELS]: [res('t1', { name: 'bug' }), res('t2', { name: 'ui' })] },
  });
  const opts = await loadCreateFormOptions(client);
  expect(opts.labels).toEqual([
    { id: 't1', label: 'bug' },
    { id: 't2', label: 'ui' },
  ]);
  expect(client.collections).toContain(LABELS);
  expect(client.collections).not.toContain('bb_term/bb_term');
});

it('AC-4: a failing label read yields an empty bag AND `errors.labels`', async () => {
  const client = fakeClient({
    rows: { [LABELS]: [res('t1', { name: 'bug' })] },
    failingCollections: [LABELS],
  });
  const opts = await loadCreateFormOptions(client);
  expect(opts.labels).toEqual([]);
  // Per bag, riding along with the bag it describes (D4) — so the renderer can
  // say WHICH read failed and WHY, instead of showing an empty vocabulary.
  expect(opts.errors?.labels).toBe(`no ${LABELS}`);
});

it('AC-4: a SUCCESSFUL load carries no `errors` key at all', async () => {
  // "Emit `errors` only when non-empty": an empty-but-successful vocabulary is an
  // answer, not a failure, and must stay distinguishable from one. Reviewers
  // need a workspace uuid so their read can succeed the same way.
  const workspaceId = 'wwwwwwww-0000-0000-0000-000000000001';
  const client = fakeClient({
    rows: {
      [LABELS]: [],
      bb_workspace: [res(workspaceId, { drupal_internal__id: 7 })],
    },
  });
  const opts = await loadCreateFormOptions(client, { workspaceId });
  expect(opts.labels).toEqual([]);
  expect(opts.reviewers).toEqual([]);
  expect(opts.errors).toBeUndefined();
});

// ---- BB-257 AC-5 / D8: the parent candidate bag ----------------------------

const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
const TICKETS = 'bb_ticket/bb_ticket';

/** The query string a recorded request carried, decoded for readability. */
const queryString = (params: unknown): string => {
  const built = params as { getQueryString(): string } | undefined;
  expect(built).toBeDefined();
  return decodeURIComponent(built?.getQueryString() ?? '');
};

const ticketDoc = {
  [TICKETS]: {
    data: [
      {
        type: 'bb_ticket--bb_ticket',
        id: 'k1',
        attributes: { identifier: 'BB-236', title: 'a declared form kernel' },
      },
      {
        type: 'bb_ticket--bb_ticket',
        id: 'k2',
        attributes: { identifier: 'BB-257', title: 'the New-ticket popup' },
      },
    ],
  },
};

it('AC-5: each candidate is labelled `bakers.build-nnn · title`', async () => {
  // The composition IS how AC-5's "matching on identifier AND on title" is met:
  // the kernel applies one case-insensitive substring rule over `Option.label`,
  // and a label built from both halves makes that rule cover both (D5).
  const client = fakeClient({ documents: ticketDoc });
  const opts = await loadCreateFormOptions(client, { projectId: PROJECT });
  expect(opts.parents?.map((p) => p.label)).toEqual([
    'BB-236 · a declared form kernel',
    'BB-257 · the New-ticket popup',
  ]);
  // …and each row keeps the two fields unflattened, so the payload never has to
  // parse a composed label back apart (AC-6).
  expect(opts.parents?.[1]).toEqual({
    id: 'k2',
    label: 'BB-257 · the New-ticket popup',
    identifier: 'BB-257',
    title: 'the New-ticket popup',
  });
});

it('D8: WITHOUT a project id there is no candidate bag at all', async () => {
  // `n` is a global key: from the dashboard no project is selected. The ABSENCE
  // of the bag is the signal the renderer turns into "(no project context …)" —
  // an empty bag would mean "this project has no tickets", a different claim.
  const client = fakeClient({ documents: ticketDoc });
  const opts = await loadCreateFormOptions(client);
  expect(opts.parents).toBeUndefined();
  // And no ticket read was even attempted.
  expect(client.gets).toEqual([]);
});

it('D8: a project id scopes the preloaded page to that project', async () => {
  const client = fakeClient({ documents: ticketDoc });
  await loadCreateFormOptions(client, { projectId: PROJECT });
  expect(client.gets).toEqual([TICKETS]);
  // Preloaded with an EMPTY query, so ←/→ works before a character is typed.
  const s = queryString(client.requests[0]?.params);
  expect(s).toContain(PROJECT);
  expect(s).not.toContain('CONTAINS');
});

it('AC-4: a failing candidate read yields `errors.parents`', async () => {
  const client = fakeClient({
    documents: ticketDoc,
    failingPaths: [TICKETS],
  });
  const opts = await loadCreateFormOptions(client, { projectId: PROJECT });
  // The bag is PRESENT and empty: a project was in scope, the read just failed.
  // That is what lets the renderer say the reason instead of "no project".
  expect(opts.parents).toEqual([]);
  expect(opts.errors?.parents).toBe(`no ${TICKETS}`);
});

// ---- AC-4, the OTHER two bags ------------------------------------------------
//
// `CreateOptionErrors` declared `users` and `conductors` from the start and the
// renderer already had a form-level row for each, but only `labels` had a
// producer — so a failing user or conductor read still reached the writer as a
// silently empty ring, which is the defect class D4 exists to remove. These two
// cases are what make the declared keys real.

it('AC-4: a failing USER read yields an empty ring AND `errors.users`', async () => {
  const client = fakeClient({
    rows: { user: [res('u1', { name: 'cw' })] },
    failingCollections: ['user'],
  });
  const opts = await loadCreateFormOptions(client, { currentUser: 'cw' });
  expect(opts.users).toEqual([]);
  expect(opts.errors?.users).toBe('no user/user');
  // Per bag: the failure of one read says nothing about the others.
  expect(opts.errors?.conductors).toBeUndefined();
  expect(opts.errors?.labels).toBeUndefined();
});

it('AC-4: a failing CONDUCTOR read yields an empty ring AND `errors.conductors`', async () => {
  const client = fakeClient({
    rows: { bb_conductor: [res('c1', { label: 'cw-framework' })] },
    failingCollections: ['bb_conductor'],
  });
  const opts = await loadCreateFormOptions(client, { projectId: 'p1' });
  expect(opts.conductors).toEqual([]);
  expect(opts.errors?.conductors).toBe('no bb_conductor/bb_conductor');
  expect(opts.errors?.users).toBeUndefined();
});

it('AC-4: every bag failing at once reports every bag, not one collapse', async () => {
  const client = fakeClient({
    failingCollections: ['user', 'bb_conductor', LABELS],
  });
  const opts = await loadCreateFormOptions(client, { projectId: 'p1' });
  expect(opts.errors?.users).toBe('no user/user');
  expect(opts.errors?.conductors).toBe('no bb_conductor/bb_conductor');
  expect(opts.errors?.labels).toBe(`no ${LABELS}`);
  // The fixed enum is not a read and therefore cannot fail.
  expect(opts.workflows.length).toBeGreaterThan(0);
  expect(opts.errors?.workflows).toBeUndefined();
});

it('orders conductors owner-first, this checkout ahead of my others (AC-14)', async () => {
  const conductor = (id: string, machineId: string, owner: string | null) =>
    toResource({
      type: 'bb_conductor--bb_conductor',
      id,
      attributes: { label: id, conductor_id: machineId },
      relationships: {
        owner_user_id: { data: owner === null ? null : { id: owner } },
      },
    });
  const client = fakeClient({
    rows: {
      bb_conductor: [
        conductor('tom', 'tom-mac-bakers', 'user-tm'),
        conductor('mine-elsewhere', 'cw-laptop-bakers', 'user-cw'),
        conductor('nobody', 'x-y-z', null),
        conductor('mine-here', 'cw-fw-bakers', 'user-cw'),
      ],
    },
  });
  const options = await loadCreateFormOptions(client, {
    currentUser: 'cw',
    ownerUserId: 'user-cw',
    ownConductorMachineId: 'cw-fw-bakers',
    projectId: 'p1',
  });
  expect(options.conductors.map((c) => c.id)).toEqual([
    'mine-here',
    'mine-elsewhere',
    'tom',
    'nobody',
  ]);
});

const WORKSPACE = 'wwwwwwww-0000-0000-0000-000000000001';

const rawUser = (id: string, attrs: Record<string, unknown>) => ({
  id,
  type: 'user--user',
  attributes: attrs,
});

const membership = (userId: string) => ({
  relationships: { uid: { data: { id: userId } }, roles: { data: [] } },
});

const reviewerClient = (
  over: {
    users?: ReturnType<typeof rawUser>[];
    members?: ReturnType<typeof membership>[];
    userPages?: ReturnType<typeof rawUser>[][];
    memberPages?: ReturnType<typeof membership>[][];
    userDoc?: Record<string, unknown>;
    memberDoc?: Record<string, unknown>;
  } = {},
) => {
  const base = fakeClient({
    rows: {
      user: [res('outsider', { display_name: 'Outsider', name: 'out' })],
      bb_workspace: [res(WORKSPACE, { drupal_internal__id: 7 })],
    },
  });
  let userPage = 0;
  let memberPage = 0;
  return {
    ...base,
    async get(path: string, params?: unknown) {
      if (path === 'user/user') {
        if (over.userDoc) return over.userDoc;
        if (over.userPages) {
          const page = over.userPages[userPage] ?? [];
          const last = userPage >= over.userPages.length - 1;
          userPage += 1;
          return last ? { data: page } : { data: page, links: { next: 'p' } };
        }
        return { data: over.users ?? [] };
      }
      if (path === 'og_membership/default') {
        if (over.memberDoc) return over.memberDoc;
        if (over.memberPages) {
          const page = over.memberPages[memberPage] ?? [];
          const last = memberPage >= over.memberPages.length - 1;
          memberPage += 1;
          return last ? { data: page } : { data: page, links: { next: 'p' } };
        }
        return { data: over.members ?? [] };
      }
      return base.get(path, params);
    },
  } as unknown as DropshClient;
};

it('reviewers bag is membership ∩ users, never the assignee bag', async () => {
  const client = reviewerClient({
    users: [
      rawUser('u0', { display_name: 'Anonymous', drupal_internal__uid: 0 }),
      rawUser('member', { display_name: 'Ada', drupal_internal__uid: 2 }),
      rawUser('outsider', {
        display_name: 'Outsider',
        drupal_internal__uid: 9,
      }),
    ],
    members: [membership('member'), membership('u0')],
  });
  const opts = await loadCreateFormOptions(client, { workspaceId: WORKSPACE });
  expect(opts.reviewers).toEqual([{ id: 'member', label: 'Ada' }]);
  expect(opts.users.map((u) => u.id)).toEqual(['outsider']);
  expect(opts.errors?.reviewers).toBeUndefined();
});

it('unresolved workspace yields a reviewer-specific error and no instance-user fallback', async () => {
  const client = fakeClient({
    rows: { user: [res('u1', { display_name: 'cw', name: 'cw' })] },
  });
  const opts = await loadCreateFormOptions(client);
  expect(opts.reviewers).toEqual([]);
  expect(opts.errors?.reviewers).toMatch(/workspace/i);
  expect(opts.users.map((u) => u.id)).toEqual(['u1']);
  expect(client.gets).toEqual([]);
});

it('a withheld membership page is a reviewer error, not all instance users', async () => {
  const client = reviewerClient({
    users: [
      rawUser('member', { display_name: 'Ada', drupal_internal__uid: 2 }),
    ],
    memberDoc: { data: [], meta: { omitted: {} } },
  });
  const opts = await loadCreateFormOptions(client, { workspaceId: WORKSPACE });
  expect(opts.reviewers).toEqual([]);
  expect(opts.errors?.reviewers).toMatch(/withheld|reviewer/i);
  expect(opts.users.map((u) => u.id)).toEqual(['outsider']);
});

it('a withheld user page is a reviewer error, not an empty-success bag', async () => {
  const client = reviewerClient({
    userDoc: { data: [], meta: { omitted: { detail: 'denied' } } },
    members: [membership('member')],
  });
  const opts = await loadCreateFormOptions(client, { workspaceId: WORKSPACE });
  expect(opts.reviewers).toEqual([]);
  expect(opts.errors?.reviewers).toMatch(/withheld|reviewer/i);
});

it('reviewer roster follows every user and membership page', async () => {
  const client = reviewerClient({
    userPages: [
      [rawUser('ada', { display_name: 'Ada', drupal_internal__uid: 2 })],
      [
        rawUser('alan', { display_name: 'Alan', drupal_internal__uid: 3 }),
        rawUser('out', { display_name: 'Out', drupal_internal__uid: 4 }),
      ],
    ],
    memberPages: [[membership('ada')], [membership('alan')]],
  });
  const opts = await loadCreateFormOptions(client, { workspaceId: WORKSPACE });
  expect(opts.reviewers.map((r) => r.id)).toEqual(['ada', 'alan']);
  expect(opts.reviewers.map((r) => r.label)).toEqual(['Ada', 'Alan']);
});

// BB-664 AC-8 — `conductorOptionSource` is exported so the screen can
// re-scope the ring a SECOND time, against whatever project the operator just
// picked in the new Project field, without a hand-written second read.
it('conductorOptionSource is the same read createFormSources composes, callable standalone', async () => {
  const { conductorOptionSource } = await import(
    '../../../../src/Entity/ticket/Form/create-data.js'
  );
  const client = fakeClient({
    rows: { bb_conductor: [res('c1', { machine_id: 'm1', label: 'one' })] },
  });
  expect(await conductorOptionSource(client, {}).load('')).toEqual({
    options: [],
  });
  expect(
    await conductorOptionSource(client, { projectId: 'p1' }).load(''),
  ).toEqual({ options: [{ id: 'c1', label: 'one' }] });
});

// Templates are read for the project in scope, and for none without one.
it('createFormSources declares a templates source only with a project', async () => {
  const { createFormSources, templateOptionSource } = await import(
    '../../../../src/Entity/ticket/Form/create-data.js'
  );
  const client = fakeClient({
    rows: {
      bb_ticket_template: [
        res('tp1', { name: 'Weekly', enabled: true }),
        res('tp2', { name: 'Off', enabled: false }),
      ],
    },
  });
  expect(createFormSources(client, {}).template).toBeUndefined();
  const source = createFormSources(client, { projectId: 'p1' }).template;
  expect(source?.bag).toBe('templates');
  expect(await templateOptionSource(client, 'p1').load('')).toEqual({
    options: [{ id: 'tp1', label: 'Weekly' }],
  });
  expect(client.filters).toContainEqual(['project_id.id', '=', 'p1']);
  const opts = await loadCreateFormOptions(client, { projectId: 'p1' });
  expect(opts.templates).toEqual([{ id: 'tp1', label: 'Weekly' }]);
  expect((await loadCreateFormOptions(client, {})).templates).toBeUndefined();
});
