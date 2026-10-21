// BB-236 — the TERM data service (`bb_term`, what the create popup happens to
// offer as its labels). It returns TERMS and knows nothing about forms; the name says
// the entity, not the widget, so a second screen wanting terms for any other purpose
// gets terms. The simple case: one read, no ordering, no filtering, no decoration.
//
// BB-257 D3 — with one correction: a term only exists inside a VOCABULARY, so the
// read has to name one, and WHICH one is the caller's choice. `bb_term` alone is
// not a bundle — dropsh's `resolveType` expands the single-segment shorthand to
// `bb_term/bb_term`, which does not exist and 404s (F2). Making the bundle a
// required argument means a future consumer must state which vocabulary it wants
// (`bb_capability_tags` is the other one on this entity type) instead of getting a
// 404; and it keeps the POLICY "this popup offers bb_labels" in the adapter, where
// every other create-popup policy lives, rather than here.
import type { DropshClient, Resource } from '../../../types.js';
import { type ListOutcome, listOutcome } from '../../transport.js';

/** One taxonomy term of the control plane, as this renderer needs it. */
export interface Term {
  id: string;
  /** Never empty — the uuid is the last fallback, so nothing renders as blank. */
  label: string;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const toTerm = (r: Resource): Term => ({
  id: r.id,
  label: str(r.attr('name')) ?? str(r.attr('label')) ?? r.id,
});

/**
 * One vocabulary's terms through one client, in server order.
 *
 * Yields the OUTCOME rather than a swallowed array: the popup has to be able to
 * say that the read failed instead of presenting an empty vocabulary (AC-4), and
 * only the read knows why it failed.
 */
export const listTerms = (
  client: DropshClient,
  bundle: string,
): Promise<ListOutcome<Term>> =>
  listOutcome(client, `bb_term/${bundle}`, toTerm);
