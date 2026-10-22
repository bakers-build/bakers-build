import { expect, it } from 'vitest';
import {
  list,
  listOutcome,
  listPreferringWrite,
} from '../../src/Entity/transport.js';
import type { Resource } from '../../src/types.js';
import { fakeClient, toResource } from '../test-support.js';

// BB-236 AC-6/AC-7 — TRANSPORT: the only module that touches a client, and the
// only one that swallows. Every best-effort rule the two loaders rely on is
// provable here with a throwing fake alone.

const rows = () => ({
  user: [toResource({ id: 'u1', type: 'user--user', attributes: {} })],
  bb_conductor: [toResource({ id: 'c1', type: 'bb_conductor--bb_conductor' })],
});
const id = (r: Resource): string => r.id;

it('list maps the collection through `map`', async () => {
  const client = fakeClient({ rows: rows() });
  expect(await list(client, 'user', id)).toEqual(['u1']);
  expect(client.collections).toEqual(['user/user']);
});

it('AC-7: a throwing collection yields an empty list, never a rejection', async () => {
  const client = fakeClient({ rows: rows(), failingCollections: ['user'] });
  await expect(list(client, 'user', id)).resolves.toEqual([]);
});

// ---- BB-257 D4: the same read, with the failure kept instead of swallowed ----
//
// APPENDED. `list` is unchanged — BB-236 AC-7's best-effort rule is right for a
// caller that has nothing to say about a failure. But rendering a 404 as an empty
// vocabulary is the defect AC-4 names, so a caller that DOES want to say something
// needs the reason. One primitive answers both: `listOutcome` keeps it, `list` is
// its one-line wrapper that drops it.

it('listOutcome yields the mapped rows and NO error on success', async () => {
  const client = fakeClient({ rows: rows() });
  const outcome = await listOutcome(client, 'user', id);
  expect(outcome.rows).toEqual(['u1']);
  expect(outcome.error).toBeUndefined();
  expect(client.collections).toEqual(['user/user']);
});

it('AC-4: listOutcome yields no rows AND the failure message on a throw', async () => {
  const client = fakeClient({ rows: rows(), failingCollections: ['user'] });
  const outcome = await listOutcome(client, 'user', id);
  expect(outcome.rows).toEqual([]);
  // The message the fake threw, verbatim — this is what reaches the popup's
  // `⚠ Labels could not be loaded: …` row.
  expect(outcome.error).toBe('no user/user');
});

it('listOutcome reports a non-Error throw as a string, never as `undefined`', async () => {
  // A caller keys "did this fail?" on `error` being present, so a thrown string
  // (or anything else) must still produce a message.
  const client: Parameters<typeof listOutcome>[0] = {
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
          throw 'permission denied';
        },
      }) as never,
  };
  expect(await listOutcome(client, 'user', id)).toEqual({
    rows: [],
    error: 'permission denied',
  });
});

it('AC-7 UNCHANGED: `list` still swallows, and is `listOutcome`s rows', async () => {
  // The contract BB-236 established and this ticket must not move: every
  // existing caller keeps getting `[]` on a failure, with no second return value
  // to handle.
  const ok = fakeClient({ rows: rows() });
  expect(await list(ok, 'user', id)).toEqual(
    (await listOutcome(fakeClient({ rows: rows() }), 'user', id)).rows,
  );
  const failing = fakeClient({ rows: rows(), failingCollections: ['user'] });
  await expect(list(failing, 'user', id)).resolves.toEqual([]);
});

it('listPreferringWrite prefers the WRITE client and never consults read', async () => {
  const write = fakeClient({ rows: rows() });
  const read = fakeClient({ rows: rows() });
  expect(await listPreferringWrite({ write, read }, 'user', id)).toEqual([
    'u1',
  ]);
  expect(read.collections).toEqual([]);
});

it('AC-7: a failing WRITE list falls back to the read client', async () => {
  const write = fakeClient({ rows: rows(), failingCollections: ['user'] });
  const read = fakeClient({ rows: rows() });
  expect(await listPreferringWrite({ write, read }, 'user', id)).toEqual([
    'u1',
  ]);
  expect(read.collections).toEqual(['user/user']);
});

it('AC-7: BOTH failing yields `[]`, so the popup still opens', async () => {
  const write = fakeClient({ rows: rows(), failingCollections: ['user'] });
  const read = fakeClient({ rows: rows(), failingCollections: ['user'] });
  await expect(
    listPreferringWrite({ write, read }, 'user', id),
  ).resolves.toEqual([]);
});

it('AC-7: an EMPTY write list is a legitimate answer — no fallback', async () => {
  // The distinction that matters: "the write scope sees nothing" is an answer, not
  // a failure. Falling back would re-offer options the write cannot reference.
  const write = fakeClient({ rows: {} });
  const read = fakeClient({ rows: rows() });
  expect(await listPreferringWrite({ write, read }, 'user', id)).toEqual([]);
  expect(read.collections).toEqual([]);
});

it('with no write client, or the SAME client twice, it reads once', async () => {
  const read = fakeClient({ rows: rows() });
  expect(await listPreferringWrite({ read }, 'user', id)).toEqual(['u1']);
  expect(read.collections).toEqual(['user/user']);

  const both = fakeClient({ rows: rows() });
  expect(
    await listPreferringWrite({ write: both, read: both }, 'user', id),
  ).toEqual(['u1']);
  expect(both.collections).toEqual(['user/user']);
});
