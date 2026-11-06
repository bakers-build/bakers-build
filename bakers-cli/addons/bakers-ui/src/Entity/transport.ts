// BB-236 — the two list primitives every data service reads through: the client
// contact and the best-effort rule, in one place because it is one rule. A failing or
// permission-gated query yields `[]`, so whatever consumes the data still works
// (AC-7). Like its callers `users.ts` / `conductors.ts` / `terms.ts` this is a data
// module: it returns data and knows nothing about forms — the mapping to a picker
// row and any policy over it belong to the adapter that wants them
// (`Form/edit-data.ts`).
import type { DropshClient, Resource } from '../types.js';

/** One list's result: the rows, and — only when the read threw — the reason. */
export interface ListOutcome<T> {
  rows: T[];
  /**
   * Absent on success, including on a successful EMPTY list. That distinction is
   * the whole point: "the vocabulary is empty" and "the request 404'd" are
   * different answers and a reader must be able to tell them apart (BB-257 AC-4).
   */
  error?: string;
}

/**
 * Anything thrown, as the message an `error` carries.
 *
 * A caller keys "did this fail?" on `error` being PRESENT, so an Error, a
 * string, or any rejected value alike must become one. Exported (BB-257)
 * because a read that does not go through `collection().list()` — the parent
 * candidate query, which needs JSON:API params and therefore `get` — must
 * produce the SAME outcome shape, and two copies of this line would be two
 * places for it to drift.
 */
export const messageOf = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

/**
 * One list through one client, keeping the failure instead of swallowing it.
 *
 * BB-257 D4 — the best-effort rule below is right for a caller that has nothing
 * to say about a failure, and wrong for one that has: rendering a 404 as an empty
 * vocabulary is the defect AC-4 names (F2). One primitive serves both — this one
 * keeps the reason, `list` drops it — so the two can never drift apart.
 */
export async function listOutcome<T>(
  client: DropshClient,
  type: string,
  map: (r: Resource) => T,
): Promise<ListOutcome<T>> {
  try {
    return { rows: (await client.collection(type).list()).map(map) };
  } catch (caught) {
    return { rows: [], error: messageOf(caught) };
  }
}

/** One list through one client. A throw becomes `[]`, never a rejection. */
export async function list<T>(
  client: DropshClient,
  type: string,
  map: (r: Resource) => T,
): Promise<T[]> {
  return (await listOutcome(client, type, map)).rows;
}

/** The clients an options load may use, by role. */
export interface OptionClients {
  /**
   * The client the form writes through. Preferred where it exists, because it is
   * the one that decides validity — a conductor it cannot reference is not an
   * option worth offering.
   *
   * Since BB-391 there is one identity, so this is normally the SAME client as
   * `read` and `listPreferringWrite` short-circuits on identity. The two members
   * survive because the distinction that matters is a role, not a profile: an
   * embedder may still hand the form a differently-configured client, and the
   * "offer only what the write can reference" rule is what keeps the options
   * honest either way. The retired reading of this pair — one profile seeing the
   * FULL conductor set while the other saw a subset — is gone: what rows an
   * identity reaches is now the OG rank's decision (BB-359).
   */
  write?: DropshClient | undefined;
  /** The read client — the per-list fallback, and the source when there is no write. */
  read: DropshClient;
}

/**
 * One list, best-effort, write client first: on a throw fall back to the READ client,
 * and on a second throw yield `[]`. An EMPTY list is a legitimate answer and never
 * triggers the fallback — "the identity reaches no such row" is an answer, not a
 * failure.
 */
export async function listPreferringWrite<T>(
  clients: OptionClients,
  type: string,
  map: (r: Resource) => T,
): Promise<T[]> {
  const { write, read } = clients;
  if (write && write !== read) {
    try {
      return (await write.collection(type).list()).map(map);
    } catch {
      // fall through to the read client — NOT back to `write`, which just failed
    }
    return list(read, type, map);
  }
  return list(write ?? read, type, map);
}
