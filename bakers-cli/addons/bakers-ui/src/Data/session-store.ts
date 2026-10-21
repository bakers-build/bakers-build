import { createStore } from 'zustand/vanilla';

/** Typed resource identity. The caller owns namespacing and value semantics. */
export interface DataKey<T> {
  readonly id: string;
  readonly valueType?: T;
}
export const dataKey = <T>(id: string): DataKey<T> => ({ id });

interface Entry {
  readonly value?: unknown;
  readonly fields: ReadonlySet<string>;
  readonly valid: boolean;
  readonly revision: number;
}

/** One in-memory data lifetime. Zustand owns storage and subscriptions. */
export function createSessionStore() {
  const state = createStore<ReadonlyMap<string, Entry>>(() => new Map());
  const pending = new Map<string, Promise<unknown>>();
  let revision = 0;
  const entry = (id: string) => state.getState().get(id);
  const put = (id: string, value: Entry) => {
    state.setState(new Map(state.getState()).set(id, value), true);
  };
  const get = <T>(key: DataKey<T>): T | undefined =>
    entry(key.id)?.value as T | undefined;
  const has = <T>(key: DataKey<T>, fields: readonly string[] = []): boolean => {
    const current = entry(key.id);
    return (
      current?.valid === true &&
      fields.every((field) => current.fields.has(field))
    );
  };
  const invalidate = <T>(key: DataKey<T>) => {
    put(key.id, {
      value: get(key),
      fields: new Set(),
      valid: false,
      revision: ++revision,
    });
  };
  const set = <T>(
    key: DataKey<T>,
    value: T,
    fields: readonly string[] = [],
  ) => {
    put(key.id, {
      value,
      fields: new Set(fields),
      valid: true,
      revision: ++revision,
    });
  };
  return {
    get,
    has,
    set,
    invalidate,
    subscribe<T>(
      key: DataKey<T>,
      listener: (value: T | undefined) => void,
    ): () => void {
      return state.subscribe((next, previous) => {
        const value = next.get(key.id)?.value;
        if (value !== previous.get(key.id)?.value)
          listener(value as T | undefined);
      });
    },
    clear(): void {
      state.setState(new Map(), true);
      pending.clear();
    },
    load<T>(
      key: DataKey<T>,
      fields: readonly string[],
      loader: (missing: readonly string[]) => Promise<T>,
      merge: (previous: T | undefined, next: T, fields: readonly string[]) => T,
    ): Promise<T> {
      if (has(key, fields)) return Promise.resolve(get(key) as T);
      if (!entry(key.id)) invalidate(key);
      const current = entry(key.id) as Entry;
      const missing = [
        ...new Set(fields.filter((field) => !current.fields.has(field))),
      ].sort();
      const requestId = JSON.stringify([key.id, current.revision, missing]);
      const existing = pending.get(requestId);
      if (existing) return existing as Promise<T>;
      // Invoke synchronously so all following calls can share this operation.
      let response: Promise<T>;
      try {
        response = loader(missing);
      } catch (error) {
        response = Promise.reject(error);
      }
      const request = response
        .then((value) => {
          const latest = entry(key.id);
          if (latest?.revision !== current.revision) return get(key) ?? value;
          const combined = merge(get(key), value, missing);
          put(key.id, {
            value: combined,
            fields: new Set([...latest.fields, ...missing]),
            valid: true,
            revision: current.revision,
          });
          return combined;
        })
        .finally(() => {
          if (pending.get(requestId) === request) pending.delete(requestId);
        });
      pending.set(requestId, request);
      return request;
    },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
