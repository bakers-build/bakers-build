import { describe, expect, it } from 'vitest';
import { createSessionStore, dataKey } from '../../src/Data/session-store.js';

const key = dataKey<{ title?: string; comments?: string[] }>('ticket/one');
const merge = (
  old: { title?: string; comments?: string[] } | undefined,
  next: { title?: string; comments?: string[] },
) => ({ ...old, ...next });

describe('session data store', () => {
  it('shares partial data within a session while keeping another session isolated', async () => {
    const a = createSessionStore();
    const b = createSessionStore();
    await a.load(key, ['title'], async () => ({ title: 'Shared' }), merge);
    await a.load(
      key,
      ['comments'],
      async () => ({ comments: ['hello'] }),
      merge,
    );
    expect(a.get(key)).toEqual({ title: 'Shared', comments: ['hello'] });
    expect(b.get(key)).toBeUndefined();
    const project = dataKey<number>('project/count');
    a.set(project, 3);
    expect(a.get(project)).toBe(3);
  });

  it('loads only missing fields and reuses a completed request', async () => {
    const store = createSessionStore();
    const calls: string[][] = [];
    const loader = async (fields: readonly string[]) => {
      calls.push([...fields]);
      return { title: 'Title' };
    };
    await store.load(key, ['title'], loader, merge);
    await store.load(key, ['title', 'comments'], loader, merge);
    await store.load(key, ['title', 'comments'], loader, merge);
    expect(calls).toEqual([['title'], ['comments']]);
  });

  it('shares concurrent identical loads', async () => {
    const store = createSessionStore();
    let calls = 0;
    let resolve!: (value: { title: string }) => void;
    const pending = new Promise<{ title: string }>((r) => {
      resolve = r;
    });
    const loader = () => {
      calls++;
      return pending;
    };
    const first = store.load(key, ['title'], loader, merge);
    const second = store.load(key, ['title'], loader, merge);
    resolve({ title: 'Once' });
    expect(await first).toEqual({ title: 'Once' });
    expect(await second).toEqual({ title: 'Once' });
    expect(calls).toBe(1);
  });

  it('invalidates coverage while retaining the last value for display', async () => {
    const store = createSessionStore();
    await store.load(key, ['title'], async () => ({ title: 'Old' }), merge);
    store.invalidate(key);
    expect(store.get(key)?.title).toBe('Old');
    expect(store.has(key, ['title'])).toBe(false);
    await store.load(key, ['title'], async () => ({ title: 'New' }), merge);
    expect(store.get(key)?.title).toBe('New');
  });

  it('rejects an older response after a newer write', async () => {
    const store = createSessionStore();
    let resolve!: (value: { title: string }) => void;
    const request = store.load(
      key,
      ['title'],
      () =>
        new Promise((r) => {
          resolve = r;
        }),
      merge,
    );
    store.set(key, { title: 'Saved' });
    resolve({ title: 'Stale' });
    expect(await request).toEqual({ title: 'Saved' });
    expect(store.get(key)?.title).toBe('Saved');
  });

  it('does not let a pre-clear request populate a replacement session', async () => {
    const store = createSessionStore();
    let resolve!: (value: { title: string }) => void;
    const request = store.load(
      key,
      ['title'],
      () =>
        new Promise((r) => {
          resolve = r;
        }),
      merge,
    );
    store.clear();
    resolve({ title: 'Stale' });
    await request;
    expect(store.get(key)).toBeUndefined();
  });

  it('notifies only subscribers of the changed resource and supports unsubscribe', () => {
    const store = createSessionStore();
    const seen: unknown[] = [];
    const unsubscribe = store.subscribe(key, (value) => seen.push(value));
    store.set(dataKey<number>('unrelated'), 4);
    store.set(key, { title: 'First' });
    unsubscribe();
    store.set(key, { title: 'Second' });
    expect(seen).toEqual([{ title: 'First' }]);
  });
});
