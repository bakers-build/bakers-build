import { expect, it, vi } from 'vitest';
import type { Option } from '../../src/Form/index.js';
import {
  createOptionLoader,
  type OptionSource,
  primeSources,
} from '../../src/Widget/index.js';

// BB-257 (re-entry) AC-12 — ONE loading path per field.
//
// Before this change the Parent field's candidates were fetched in
// `Data/parents.ts`, re-labelled in the create form's adapter (since removed), and debounced,
// cancelled, swapped and error-merged a third time in `Kernel/tui-kernel.ts`. The
// contract below is what collapses those three into one: a field declares ONE
// source (fetch + label + error, in the slice that knows the service), and this
// generic driver owns the debounce, the supersession and the bag swap for every
// field alike — so the kernel names no field at all.

interface Bags {
  people?: Option[] | undefined;
  places?: Option[] | undefined;
  errors?: Record<string, string> | undefined;
}

const source = (
  bag: string,
  rows: (query: string) => Option[],
  over: Partial<OptionSource> = {},
): OptionSource => ({
  bag,
  load: async (query: string) => ({ options: rows(query) }),
  ...over,
});

it('AC-12: priming fills every declared bag in parallel, keyed by the source', async () => {
  const { bags, errors } = await primeSources({
    owner: source('people', () => [{ id: 'p1', label: 'ada' }]),
    where: source('places', () => [{ id: 'x', label: 'here' }]),
  });
  expect(bags).toEqual({
    people: [{ id: 'p1', label: 'ada' }],
    places: [{ id: 'x', label: 'here' }],
  });
  expect(errors).toEqual({});
});

it('AC-12: a source that fails contributes its bag AND its own error, alone', async () => {
  const { bags, errors } = await primeSources({
    owner: source('people', () => [], {
      load: async () => ({ options: [], error: 'HTTP 403' }),
    }),
    where: source('places', () => [{ id: 'x', label: 'here' }]),
  });
  expect(bags.people).toEqual([]);
  expect(bags.places).toEqual([{ id: 'x', label: 'here' }]);
  expect(errors).toEqual({ people: 'HTTP 403' });
});

it('AC-12: a field with NO source contributes no bag at all', async () => {
  // Absence is a state the renderer draws ("nothing can be offered"), so a bag
  // that was never declared must not appear as an empty array.
  const { bags } = await primeSources({});
  expect(Object.hasOwn(bags, 'people')).toBe(false);
});

// ---- the debounced re-query -------------------------------------------------

const loaderFor = (
  sources: Record<string, OptionSource>,
  debounce: (fn: () => void, ms: number) => () => void,
) => {
  let current: Bags | null = { people: [], errors: undefined };
  const loader = createOptionLoader<Bags>({
    sources,
    debounce,
    current: () => current,
    onLoaded: (next) => {
      current = next;
    },
  });
  return {
    loader,
    read: () => current,
    close: () => {
      current = null;
    },
  };
};

it('AC-12: a re-query is DEBOUNCED at the source`s own interval', () => {
  const scheduled: number[] = [];
  const { loader } = loaderFor(
    { owner: source('people', () => [], { debounceMs: 150 }) },
    (_fn, ms) => {
      scheduled.push(ms);
      return () => {};
    },
  );
  loader.reload('owner', 'a');
  loader.reload('owner', 'ab');
  expect(scheduled).toEqual([150, 150]);
});

it('AC-12: each keystroke SUPERSEDES the pending call rather than queuing one', () => {
  let cancels = 0;
  const { loader } = loaderFor(
    { owner: source('people', () => [], { debounceMs: 150 }) },
    () => () => {
      cancels += 1;
    },
  );
  loader.reload('owner', 'a');
  loader.reload('owner', 'ab');
  loader.reload('owner', 'abc');
  // Two of the three superseded a pending call; the third is still pending.
  expect(cancels).toBe(2);
  loader.cancel();
  expect(cancels).toBe(3);
});

it('AC-12: a landed re-query swaps the bag in and clears that bag`s error', async () => {
  const { loader, read } = loaderFor(
    {
      owner: source('people', (q) => [{ id: q, label: q }], {
        debounceMs: 10,
      }),
    },
    (fn) => {
      fn();
      return () => {};
    },
  );
  loader.reload('owner', 'ada');
  await vi.waitFor(() => expect(read()?.people).toHaveLength(1));
  expect(read()?.people).toEqual([{ id: 'ada', label: 'ada' }]);
  expect(read()?.errors).toBeUndefined();
});

it('AC-12: a failed re-query records ONLY its own bag`s error', async () => {
  const { loader, read } = loaderFor(
    {
      owner: source('people', () => [], {
        debounceMs: 10,
        load: async () => ({ options: [], error: 'boom' }),
      }),
    },
    (fn) => {
      fn();
      return () => {};
    },
  );
  loader.reload('owner', 'x');
  await vi.waitFor(() => expect(read()?.errors).toEqual({ people: 'boom' }));
});

it('AC-12: a response landing after the form closed is dropped, not applied', async () => {
  // The in-flight guard the kernel used to carry by hand. A bag swapped into a
  // form that is gone is a crash waiting; owning it here means every field gets
  // the guard, not only the one whose author remembered it.
  let resolveLoad: ((rows: Option[]) => void) | undefined;
  const { loader, read, close } = loaderFor(
    {
      owner: source('people', () => [], {
        debounceMs: 0,
        load: () =>
          new Promise((resolve) => {
            resolveLoad = (rows) => resolve({ options: rows });
          }),
      }),
    },
    (fn) => {
      fn();
      return () => {};
    },
  );
  loader.reload('owner', 'x');
  close();
  resolveLoad?.([{ id: 'late', label: 'late' }]);
  await Promise.resolve();
  expect(read()).toBeNull();
});

it('AC-12: a field with no source is a no-op, never a throw', () => {
  const { loader } = loaderFor({}, (fn) => {
    fn();
    return () => {};
  });
  expect(() => loader.reload('nobody', 'x')).not.toThrow();
});
