import { expect, it } from 'vitest';
import type { DropshClient } from '../src/types.js';
import {
  fakeClient,
  resolveCollectionPath,
  toResource,
} from './test-support.js';

// Smoke check for the dropsh `toResource` accessor contract the fakes rely on:
// `.attr()` reads attributes, `.rel()` yields the first (or single) linkage id,
// `.rels()` yields every linkage id — exactly what the real dropsh collection
// returns. A regression here would silently read `undefined` in every service
// test, so pin the accessor semantics directly.
it('toResource exposes attr/rel/rels over a raw JSON:API object', () => {
  const resource = toResource({
    id: 't1',
    type: 'bb_ticket--bb_ticket',
    attributes: { title: 'A ticket', state: 'coding' },
    relationships: {
      project_id: { data: { id: 'p1' } },
      labels: { data: [{ id: 'l1' }, { id: 'l2' }] },
      assignee: { data: null },
    },
  });
  expect(resource.id).toBe('t1');
  expect(resource.type).toBe('bb_ticket--bb_ticket');
  expect(resource.attr('title')).toBe('A ticket');
  expect(resource.attr('missing')).toBeUndefined();
  // A to-one relationship yields the single id; a to-many yields the first.
  expect(resource.rel('project_id')).toBe('p1');
  expect(resource.rel('labels')).toBe('l1');
  // An empty / absent relationship yields null (rel) / [] (rels).
  expect(resource.rel('assignee')).toBeNull();
  expect(resource.rels('labels')).toEqual(['l1', 'l2']);
  expect(resource.rels('missing')).toEqual([]);
});

// BB-233 Phase 1: the double must satisfy the WIDENED `DropshClient` — the
// interface now carries `update()` (spec Decision 2), and a fake that silently
// lacked it would make every write test a no-op that still passed.
it('fakeClient satisfies the DropshClient contract, update() included', async () => {
  const client: DropshClient = fakeClient();
  expect(typeof client.collection).toBe('function');
  expect(typeof client.get).toBe('function');
  expect(typeof client.update).toBe('function');
});

it('fakeClient records every update, get and collection call', async () => {
  const client = fakeClient({
    rows: { user: [toResource({ id: 'u1', type: 'user--user' })] },
    documents: { 'bb_ticket/bb_ticket/t1': { data: { id: 't1' } } },
  });
  expect(await client.collection('user').list()).toHaveLength(1);
  expect(await client.get('bb_ticket/bb_ticket/t1?include=x')).toEqual({
    data: { id: 't1' },
  });
  await client.update('bb_ticket--bb_ticket', 't1', {
    relationships: { conductor_id: { data: null } },
  });

  expect(client.collections).toEqual(['user/user']);
  expect(client.gets).toEqual(['bb_ticket/bb_ticket/t1?include=x']);
  expect(client.writes).toEqual([
    {
      type: 'bb_ticket--bb_ticket',
      id: 't1',
      body: { relationships: { conductor_id: { data: null } } },
    },
  ]);
});

// ---- BB-257 D12: the fake resolves a spec the way dropsh does -------------
//
// APPENDED. Without this the fake keyed rows by whatever string it was handed, so
// dropsh's single-segment expansion was invisible and the whole bundle-path class
// of defect could not be tested (F2b). The guard belongs here, next to
// `toResource`'s: both exist so the double answers what the REAL client asks.

it('resolveCollectionPath mirrors dropsh: shorthand, path and type all resolve', () => {
  expect(resolveCollectionPath('bb_run')).toBe('bb_run/bb_run');
  expect(resolveCollectionPath('bb_term/label')).toBe('bb_term/label');
  expect(resolveCollectionPath('bb_term--label')).toBe('bb_term/label');
});

it('fakeClient records the RESOLVED path, so a wrong bundle cannot pass', () => {
  const client = fakeClient();
  client.collection('bb_term');
  client.collection('bb_term/label');
  // The two are different requests, and only the second one exists on the
  // control plane — which is exactly BB-257 F2.
  expect(client.collections).toEqual(['bb_term/bb_term', 'bb_term/label']);
});

it('rows and failingCollections may be keyed in EITHER form', async () => {
  const row = toResource({ id: 'u1', type: 'user--user' });
  // Shorthand fixture, shorthand request.
  expect(
    await fakeClient({ rows: { user: [row] } })
      .collection('user')
      .list(),
  ).toHaveLength(1);
  // Shorthand fixture, resolved-path request — the same collection.
  expect(
    await fakeClient({ rows: { user: [row] } })
      .collection('user/user')
      .list(),
  ).toHaveLength(1);
  // …and a DIFFERENT bundle is not answered by it.
  expect(
    await fakeClient({ rows: { 'bb_term/label': [row] } })
      .collection('bb_term')
      .list(),
  ).toEqual([]);
  await expect(
    fakeClient({ failingCollections: ['user/user'] })
      .collection('user')
      .list(),
  ).rejects.toThrow('no user/user');
});

// ---- the client contract offers no entity create --------------------------
//
// Ticket creation left the TUI, and with it the only caller of
// `DropshClient.create`. The double mirrors the narrowed contract, so a create
// slipping back in shows up here as well as in the type check.

it('the double offers no create()', () => {
  expect('create' in fakeClient()).toBe(false);
});

it('fakeClient can be told to fail a collection or a write', async () => {
  const failing = fakeClient({ failingCollections: ['bb_conductor'] });
  await expect(failing.collection('bb_conductor').list()).rejects.toThrow();

  const rejecting = fakeClient({ writeError: new Error('nope') });
  await expect(
    rejecting.update('bb_ticket--bb_ticket', 't1', {}),
  ).rejects.toThrow('nope');
  // The call is recorded even when it rejects — a rejected write still happened.
  expect(rejecting.writes).toHaveLength(1);
});
