import type { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { expect, it, vi } from 'vitest';
import {
  listAllUsers,
  listUsersPreferringWrite,
  loadWhoCandidates,
  resolveWhoCandidate,
  WHO_PAGE_SIZE,
} from '../../../../src/Entity/user/Data/users.js';
import type { DropshClient } from '../../../../src/types.js';
import { fakeClient, toResource } from '../../../test-support.js';

// BB-236 — the USER data service returns USERS. Everything asserted here is a
// property of the data: the fields, the label fallbacks, the `uid` typing, and the
// read strategies. Nothing here knows a popup exists — no ordering, no
// filtering, no `Option`. Those are the adapters' rules and are asserted in
// `edit-data.test.ts`.

const user = (
  id: string,
  attrs: Record<string, unknown> = {},
): ReturnType<typeof toResource> =>
  toResource({ id, type: 'user--user', attributes: attrs });

const rows = () => ({
  user: [
    user('u0', {
      display_name: 'Anonymous',
      name: '',
      drupal_internal__uid: 0,
    }),
    user('u1', {
      display_name: 'other',
      name: 'other',
      drupal_internal__uid: 1,
    }),
    user('u2', { display_name: 'cw', name: 'cw', drupal_internal__uid: 2 }),
  ],
});

it('a user carries id, label, username and uid — and nothing else', async () => {
  const client = fakeClient({
    rows: {
      user: [
        user('u1', {
          display_name: 'cw',
          name: 'cw-login',
          drupal_internal__uid: 3,
        }),
      ],
    },
  });
  expect(
    await listUsersPreferringWrite({ write: client, read: client }),
  ).toEqual([{ id: 'u1', label: 'cw', name: 'cw-login', uid: 3 }]);
  expect(client.collections).toEqual(['user/user']);
});

it('the label falls back display_name → name → uuid, and is never empty', async () => {
  const client = fakeClient({
    rows: {
      user: [
        user('u2', { name: 'tm' }),
        user('u3'),
        // An EMPTY string is not a label — Anonymous has `name: ''`.
        user('u0', { display_name: '', name: '' }),
      ],
    },
  });
  expect(
    (await listUsersPreferringWrite({ write: client, read: client })).map(
      (u) => u.label,
    ),
  ).toEqual(['tm', 'u3', 'u0']);
});

it('`uid` is a number, so Anonymous`s 0 stays comparable; absent is undefined', async () => {
  const client = fakeClient({
    rows: {
      user: [
        user('u0', { display_name: 'Anonymous', drupal_internal__uid: 0 }),
        // A uid that never loaded is `undefined`, NOT 0 — the distinction any
        // Anonymous filter rests on. A non-numeric value is no uid either.
        user('u9'),
        user('u8', { drupal_internal__uid: '0' }),
      ],
    },
  });
  const users = await listUsersPreferringWrite({ write: client, read: client });
  expect(users[0]?.uid).toBe(0);
  expect(users[1]?.uid).toBeUndefined();
  expect(users[2]?.uid).toBeUndefined();
});

it('listUsersPreferringWrite reads the write client first, the read client as fallback', async () => {
  const write = fakeClient({ rows: rows() });
  const read = fakeClient({ rows: rows() });
  expect((await listUsersPreferringWrite({ write, read })).length).toBe(3);
  expect(write.collections).toEqual(['user/user']);
  expect(read.collections).toEqual([]);

  const failing = fakeClient({ rows: rows(), failingCollections: ['user'] });
  const fallback = fakeClient({ rows: rows() });
  expect(
    (await listUsersPreferringWrite({ write: failing, read: fallback })).length,
  ).toBe(3);
  expect(fallback.collections).toEqual(['user/user']);
});

it('AC-7: a failing user list yields `[]` when both clients fail', async () => {
  const failing = fakeClient({ rows: rows(), failingCollections: ['user'] });
  expect(
    await listUsersPreferringWrite({ write: failing, read: failing }),
  ).toEqual([]);
});

it('listAllUsers follows every page and refuses withheld identities', async () => {
  const get = vi.fn(async (_path: string, params?: unknown) => {
    const query = decodeURIComponent(
      (params as DrupalJsonApiParams | undefined)?.getQueryString() ?? '',
    );
    return query.includes('page[offset]')
      ? {
          data: [
            rawUser('u2', {
              display_name: 'Second',
              drupal_internal__uid: 3,
            }),
          ],
        }
      : {
          data: [
            rawUser('u1', {
              display_name: 'First',
              drupal_internal__uid: 2,
            }),
          ],
          links: { next: 'page-2' },
        };
  });
  const complete = { get, collection: vi.fn() } as unknown as DropshClient;
  expect((await listAllUsers(complete)).rows.map(({ id }) => id)).toEqual([
    'u1',
    'u2',
  ]);
  for (const [, params] of get.mock.calls) {
    const query = decodeURIComponent(
      (params as DrupalJsonApiParams).getQueryString(),
    );
    expect(query).toContain('sort=drupal_internal__uid');
  }

  const withheld = {
    get: vi.fn().mockResolvedValue({
      data: [],
      meta: { omitted: { detail: 'denied' } },
    }),
    collection: vi.fn(),
  } as unknown as DropshClient;
  const outcome = await listAllUsers(withheld);
  expect(outcome.rows).toEqual([]);
  expect(outcome.error).toContain('withheld');
});

// ---- BB-299 D5: the Who picker's candidate read -------------------------
//
// `loadWhoCandidates` is the DATA half of the Who filter: it reads `user/user`
// through `client.get` (the candidate query needs JSON:API params, like the
// parent candidate read), maps the same label policy as `listUsers`, drops
// uid 0 (F6 — the `excludeAnonymous` rule at the one place every Who consumer
// reads through), and takes NO criteria — the candidate read never sees the
// filter it feeds.

const rawUser = (id: string, attrs: Record<string, unknown> = {}) => ({
  id,
  type: 'user--user',
  attributes: attrs,
});

it('loadWhoCandidates maps rows to {id, label, uid} — label = display_name ?? name ?? id', async () => {
  const client = fakeClient({
    documents: {
      'user/user': {
        data: [
          rawUser('u1', {
            display_name: 'Christoph',
            name: 'cw',
            drupal_internal__uid: 2,
          }),
          rawUser('u2', { name: 'tm', drupal_internal__uid: 3 }),
          rawUser('u3', { drupal_internal__uid: 4 }),
        ],
      },
    },
  });
  expect((await loadWhoCandidates(client, 'c')).rows).toEqual([
    { id: 'u1', label: 'Christoph', uid: 2 },
    { id: 'u2', label: 'tm', uid: 3 },
    { id: 'u3', label: 'u3', uid: 4 },
  ]);
  expect(client.requests.map((r) => r.path)).toEqual(['user/user']);
});

it('loadWhoCandidates filters name CONTAINS the query and pages at WHO_PAGE_SIZE', async () => {
  const client = fakeClient({ documents: { 'user/user': { data: [] } } });
  await loadWhoCandidates(client, 'cw');
  const params = client.requests[0]?.params as {
    getQueryString(): string;
  };
  const s = decodeURIComponent(params.getQueryString());
  expect(s).toContain('name');
  expect(s).toContain('CONTAINS');
  expect(s).toContain('cw');
  expect(s).toContain(`page[limit]=${WHO_PAGE_SIZE}`);
});

it('loadWhoCandidates drops the uid-0 row (Anonymous is never a candidate)', async () => {
  const client = fakeClient({
    documents: {
      'user/user': {
        data: [
          rawUser('u0', {
            display_name: 'Anonymous',
            name: '',
            drupal_internal__uid: 0,
          }),
          rawUser('u1', { name: 'cw', drupal_internal__uid: 2 }),
        ],
      },
    },
  });
  const outcome = await loadWhoCandidates(client, 'cw');
  expect(outcome.rows.map((u) => u.id)).toEqual(['u1']);
});

it('loadWhoCandidates keeps the outcome shape on a failing read', async () => {
  const failing = fakeClient({ failingPaths: ['user/user'] });
  const outcome = await loadWhoCandidates(failing, 'cw');
  expect(outcome.rows).toEqual([]);
  expect(outcome.error).toBe('no user/user');
  // A successful EMPTY list is not an error (BB-257 D4's distinction).
  const empty = await loadWhoCandidates(fakeClient({}), 'cw');
  expect(empty.rows).toEqual([]);
  expect(empty.error).toBeUndefined();
});

// ---- BB-287 D4: the mine toggle's identity resolution ---------------------
//
// Same user read as the Who picker, but EXACT: the toggle filters tickets on
// the resolved uuid, so a CONTAINS hit on a sibling name ('cw' ⊂ 'cw2') would
// filter on the wrong user.

it('resolveWhoCandidate filters name EXACTLY — no CONTAINS — and pages at WHO_PAGE_SIZE', async () => {
  const client = fakeClient({ documents: { 'user/user': { data: [] } } });
  await resolveWhoCandidate(client, 'cw');
  const params = client.requests[0]?.params as {
    getQueryString(): string;
  };
  const s = decodeURIComponent(params.getQueryString());
  expect(s).toContain('filter[name]=cw');
  expect(s).not.toContain('CONTAINS');
  expect(s).toContain(`page[limit]=${WHO_PAGE_SIZE}`);
});

// `me()` answers with the account's uuid since machines are identified by uuid,
// so the current user arrives as a uuid; a name must still resolve by name.
it('resolveWhoCandidate looks a uuid up by id, not by name', async () => {
  const client = fakeClient({ documents: { 'user/user': { data: [] } } });
  await resolveWhoCandidate(client, '7ec10a10-9703-4f6b-8ae1-7087315d2471');
  const params = client.requests[0]?.params as {
    getQueryString(): string;
  };
  const s = decodeURIComponent(params.getQueryString());
  expect(s).toContain('filter[id]=7ec10a10-9703-4f6b-8ae1-7087315d2471');
  expect(s).not.toContain('filter[name]');
});

it('resolveWhoCandidate returns at most the FIRST match, mapped like a Who candidate', async () => {
  const client = fakeClient({
    documents: {
      'user/user': {
        data: [
          rawUser('u1', {
            display_name: 'Christoph',
            name: 'cw',
            drupal_internal__uid: 2,
          }),
          rawUser('u2', { name: 'cw', drupal_internal__uid: 3 }),
        ],
      },
    },
  });
  expect((await resolveWhoCandidate(client, 'cw')).rows).toEqual([
    { id: 'u1', label: 'Christoph', uid: 2 },
  ]);
});

it('resolveWhoCandidate drops the uid-0 row', async () => {
  const client = fakeClient({
    documents: {
      'user/user': {
        data: [rawUser('u0', { name: 'cw', drupal_internal__uid: 0 })],
      },
    },
  });
  expect((await resolveWhoCandidate(client, 'cw')).rows).toEqual([]);
});

it('resolveWhoCandidate keeps the outcome shape on a failing read; empty success is no error', async () => {
  const failing = fakeClient({ failingPaths: ['user/user'] });
  const outcome = await resolveWhoCandidate(failing, 'cw');
  expect(outcome.rows).toEqual([]);
  expect(outcome.error).toBe('no user/user');
  const empty = await resolveWhoCandidate(fakeClient({}), 'cw');
  expect(empty.rows).toEqual([]);
  expect(empty.error).toBeUndefined();
});
