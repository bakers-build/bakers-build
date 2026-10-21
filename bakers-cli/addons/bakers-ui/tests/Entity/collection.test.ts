// BB-294 AC 3 — one collection-document shape. Five were declared and only two
// carried links.next, which is the only valid end-of-list signal: a page can be
// full without being the last one, so `rows.length === limit` answers nothing and
// only `links.next` says whether more follows.
//
// BB-292 D6e adds the second thing a page response carries about its
// collection: `meta.count`, the collection's size (BB-305).
import { expect, it, vi } from 'vitest';
import { loadPage } from '../../src/Entity/collection.js';
import type { DropshClient, JsonApiResource } from '../../src/types.js';

const client = (doc: unknown): DropshClient =>
  ({ get: vi.fn().mockResolvedValue(doc) }) as unknown as DropshClient;

const rowsFrom = (data: JsonApiResource[]): string[] =>
  data.map((item) => item.id ?? '');

it('maps rows, carries the requested page and reads hasNext off links.next', async () => {
  const page = await loadPage(
    client({
      data: [{ id: 'a' }, { id: 'b' }],
      links: { next: 'http://x/?page=1' },
    }),
    'bb_ticket/bb_ticket',
    {},
    rowsFrom,
    2,
    { offset: 40, limit: 20 },
  );
  expect(page).toEqual({
    rows: ['a', 'b'],
    hasNext: true,
    page: 2,
    total: null,
    window: { offset: 40, limit: 20 },
  });
});

it('the window is the READ, not an inference — it is carried verbatim', async () => {
  // BB-312 D3: `page[offset]`/`page[limit]` are facts about the request the
  // client made, so the page states them rather than letting a screen re-derive
  // them from a page index and a constant it does not own.
  const page = await loadPage(
    client({ data: [{ id: 'a' }] }),
    'p',
    {},
    rowsFrom,
    0,
    { offset: 0, limit: 20 },
  );
  expect(page.window).toEqual({ offset: 0, limit: 20 });
});

it('a page with no links.next is the last page', async () => {
  const page = await loadPage(
    client({ data: [{ id: 'a' }] }),
    'p',
    {},
    rowsFrom,
    0,
    { offset: 0, limit: 20 },
  );
  expect(page.hasNext).toBe(false);
});

it('a SHORT page still offers next when links.next is present', async () => {
  // A page shorter than the limit is not evidence of the end, and a page equal to
  // it is not evidence of more: `links.next` is the only thing that says.
  const page = await loadPage(
    client({ data: [{ id: 'a' }], links: { next: 'http://x' } }),
    'bb_run/bb_run',
    {},
    rowsFrom,
    0,
    { offset: 0, limit: 20 },
  );
  expect(page.hasNext).toBe(true);
});

it('an empty or absent document yields no rows and no next', async () => {
  expect(
    await loadPage(client({}), 'p', {}, rowsFrom, 0, { offset: 0, limit: 20 }),
  ).toEqual({
    rows: [],
    hasNext: false,
    page: 0,
    total: null,
    window: { offset: 0, limit: 20 },
  });
  expect(
    await loadPage(client(undefined), 'p', {}, rowsFrom, 0, {
      offset: 0,
      limit: 20,
    }),
  ).toEqual({
    rows: [],
    hasNext: false,
    page: 0,
    total: null,
    window: { offset: 0, limit: 20 },
  });
});

it('hands included to the mapper so a slice keeps its own indexing', async () => {
  const page = await loadPage(
    client({
      data: [{ id: 'a' }],
      included: [{ id: 'i1', attributes: { identifier: 'BB-1' } }],
    }),
    'p',
    {},
    (data, included) =>
      data.map(() => included[0]?.attributes?.identifier as string),
    0,
    { offset: 0, limit: 20 },
  );
  expect(page.rows).toEqual(['BB-1']);
});

// BB-292 D6e — the total is read off the page response's document-level
// `meta.count`, which BB-305 makes every `bb_*` collection report. Verified on
// the wire against a site carrying that branch's PHP:
// `GET /jsonapi/bb_ticket/bb_ticket?page[limit]=2` -> `"meta":{"count":0}`.

it('total is the document-level meta.count', async () => {
  const page = await loadPage(
    client({
      data: [{ id: 'a' }, { id: 'b' }],
      meta: { count: 107 },
      links: { next: 'http://x' },
    }),
    'p',
    {},
    rowsFrom,
    0,
    { offset: 0, limit: 20 },
  );
  expect(page.total).toBe(107);
});

it('a count of zero is a total, not an absent one', async () => {
  // The measured anonymous read: access filtering leaves no rows and the server
  // says so with `count: 0`. Falsy, and still an answer.
  const page = await loadPage(
    client({ data: [], meta: { count: 0 } }),
    'p',
    {},
    rowsFrom,
    0,
    { offset: 0, limit: 20 },
  );
  expect(page.total).toBe(0);
});

it('a document with no meta at all reports no total', async () => {
  const page = await loadPage(
    client({ data: [{ id: 'a' }], links: { next: 'http://x' } }),
    'p',
    {},
    rowsFrom,
    0,
    { offset: 0, limit: 20 },
  );
  expect(page.total).toBeNull();
});

it('a meta without a count reports no total', async () => {
  // The measured dev2 shape while that instance runs `develop`: `meta` is present
  // and carries only `omitted`. A server that does not report a total must not be
  // guessed at (AC 8.5).
  const page = await loadPage(
    client({ data: [{ id: 'a' }], meta: { omitted: { detail: 'x' } } }),
    'p',
    {},
    rowsFrom,
    0,
    { offset: 0, limit: 20 },
  );
  expect(page.total).toBeNull();
  expect(page.withheld).toBe(true);
});

it('a count that is not a usable number reports no total', async () => {
  for (const count of [
    '107',
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    {},
  ]) {
    const page = await loadPage(
      client({ data: [{ id: 'a' }], meta: { count } }),
      'p',
      {},
      rowsFrom,
      0,
      { offset: 0, limit: 20 },
    );
    expect(page.total).toBeNull();
  }
});

it('reading the total costs exactly one read', async () => {
  // AC 8.2/8.4 — the total travels with the rows, so nothing is added to the paint
  // path and paging does not re-count.
  const c = client({ data: [{ id: 'a' }], meta: { count: 9 } });
  const page = await loadPage(c, 'p', {}, rowsFrom, 0, {
    offset: 0,
    limit: 20,
  });
  expect(page.total).toBe(9);
  expect(c.get).toHaveBeenCalledTimes(1);
});

it('passes the path and params through to the client verbatim', async () => {
  const c = client({ data: [] });
  await loadPage(c, 'bb_run/bb_run', { 'page[limit]': 20 }, rowsFrom, 0, {
    offset: 0,
    limit: 20,
  });
  expect(c.get).toHaveBeenCalledWith('bb_run/bb_run', {
    'page[limit]': 20,
  });
});
