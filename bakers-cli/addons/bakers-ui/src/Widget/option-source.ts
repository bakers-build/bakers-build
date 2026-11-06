// BB-257 (re-entry) AC-12 — ONE loading path per field.
//
// The review found the Parent field's candidates being fetched in
// `Entity/ticket/Data/parents.ts`, re-labelled by a second function in
// the create form's adapter (since removed), and debounced, cancelled, swapped and
// error-merged a THIRD time in `Kernel/tui-kernel.ts` — with two kernel state
// variables that existed only because the field could not reload itself. Beside
// it a shared adapter hand-aggregated four bags eagerly with `Promise.all`,
// including bags for fields the writer never touches.
//
// The split that replaces it has exactly two halves, and neither duplicates the
// other:
//
//   * an `OptionSource` — declared in the slice that knows the service, because
//     only that layer can turn a ticket into an `Option` and only it knows which
//     read to perform. Fetching, labelling and the error belong together and are
//     written once, there.
//   * this module — the GENERIC driver: prime every declared source in parallel,
//     debounce and supersede a re-query, drop a response that outlived its form,
//     and swap the bag plus its error back in. None of that is per-field, so
//     none of it is written per field, and the kernel is left naming no field at
//     all.
//
// It sits in the widget layer because it is the loading half of the same
// contract the widgets render: a field kind that can be searched needs somewhere
// to search, and this is the shape of "somewhere".

import type { Option } from '../Form/index.js';
import type { Debounce } from '../types.js';

/** What one load produced: the bag, and why it is empty if it is. */
export interface OptionOutcome<T extends Option = Option> {
  options: T[];
  error?: string | undefined;
}

/** A field's own way of obtaining its options. */
export interface OptionSource<T extends Option = Option> {
  /** The key this source's rows are stored under in the options object. */
  readonly bag: string;
  /**
   * How long to wait after a keystroke before re-querying, in milliseconds.
   *
   * Absent means the bag is never re-queried from a keystroke — it is primed
   * once and filtered locally, which is what every non-searchable bag does.
   */
  readonly debounceMs?: number | undefined;
  load(query: string): Promise<OptionOutcome<T>>;
}

/** Sources by FIELD id. Keyed by field so the driver never needs a bag→field map. */
export type OptionSources = Readonly<Record<string, OptionSource>>;

/**
 * Load every declared source in parallel, once.
 *
 * Replaces the hand-written `Promise.all` + hand-aggregated error object: a
 * source that is not declared contributes NO bag, which is how "absent" stays
 * distinguishable from "empty" (the Parent field with no project in scope).
 */
export async function primeSources(sources: OptionSources): Promise<{
  bags: Record<string, Option[]>;
  errors: Record<string, string>;
}> {
  const entries = Object.values(sources);
  const outcomes = await Promise.all(entries.map((s) => s.load('')));
  const bags: Record<string, Option[]> = {};
  const errors: Record<string, string> = {};
  entries.forEach((source, i) => {
    const outcome = outcomes[i];
    if (outcome === undefined) return;
    bags[source.bag] = outcome.options;
    if (outcome.error !== undefined) errors[source.bag] = outcome.error;
  });
  return { bags, errors };
}

/** The handle a form holds onto while it is open. */
export interface OptionLoader {
  /** Re-query `fieldId`'s bag for `query`, superseding any pending call. */
  reload(fieldId: string, query: string): void;
  /** Drop a pending call — on close, on submit, on teardown. */
  cancel(): void;
}

/**
 * The debounce every open form used to bring its own copy of.
 *
 * Four screens carried the identical `setTimeout`/`clearTimeout` pair as a
 * fallback behind `context.options.debounce`, which is the seam a test uses to
 * make the re-query synchronous. The seam is worth keeping and the copies are
 * not: this is the default, stated once, so a caller supplies a debounce only
 * when it has one of its own.
 */
export const timerDebounce: Debounce = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export interface OptionLoaderDeps<O extends object> {
  sources: OptionSources;
  /** The injected debounce, or {@link timerDebounce} when there is none. */
  debounce?: Debounce | undefined;
  /** The live options object, or null once the form is gone. */
  current(): O | null;
  /** Hand back the options object with the fresh bag merged in. */
  onLoaded(next: O): void;
}

/** The shape the merge needs: a bag map that may carry an `errors` object. */
interface Mergeable {
  errors?: Record<string, string> | undefined;
}

/**
 * The debounced, cancellable, self-guarding re-query driver.
 *
 * One instance per open form. It owns the three things the kernel used to own by
 * hand for one field: the pending-call token (so a newer keystroke supersedes an
 * older one — that is what makes it a debounce and not a queue), the in-flight
 * guard (a bag swapped into a form that has closed is a crash waiting), and the
 * merge (set this bag's error, or clear it, and touch no other bag's).
 */
export function createOptionLoader<O extends object>(
  deps: OptionLoaderDeps<O>,
): OptionLoader {
  let pending: (() => void) | null = null;

  const merge = (source: OptionSource, outcome: OptionOutcome): void => {
    const current = deps.current();
    // The form may have closed, or been reopened, while the read was in flight.
    if (current === null) return;
    const errors = { ...(current as Mergeable).errors };
    if (outcome.error === undefined) delete errors[source.bag];
    else errors[source.bag] = outcome.error;
    deps.onLoaded({
      ...current,
      [source.bag]: outcome.options,
      // `undefined` rather than an empty object, so "no errors" stays the
      // ABSENCE of the key and every fixture that omits it stays valid.
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    } as O);
  };

  return {
    reload(fieldId, query) {
      const source = deps.sources[fieldId];
      // A field with no source declared is inert, not an error: a field with
      // nothing to search must stay typeable.
      if (source === undefined || source.debounceMs === undefined) return;
      pending?.();
      pending = (deps.debounce ?? timerDebounce)(() => {
        pending = null;
        void source.load(query).then((outcome) => {
          merge(source, outcome);
        });
      }, source.debounceMs);
    },
    cancel() {
      pending?.();
      pending = null;
    },
  };
}
