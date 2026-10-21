// BB-236 AC-8 — the live run on a ticket, derived from the detail document alone.
// Its subject is RUNS, so it lives with the other run derivations (`run-status.ts`,
// `liveness.ts`) rather than in a form module. Moved from `Service/edit-form.ts`
// unchanged: no behaviour, signature or output difference.
import type { JsonApiResource, TicketDetailDocument } from '../../../types.js';

/** What the AC-8 warning names: who is working the ticket, and in what state. */
export interface ActiveRunInfo {
  identifier: string;
  machine: string;
  runState: string;
}

/** Run states that mean "someone is working on this right now". */
const ACTIVE_RUN_STATES = new Set(['claimed', 'running']);

const attr = (r: JsonApiResource | undefined, key: string): string =>
  typeof r?.attributes?.[key] === 'string' ? (r.attributes[key] as string) : '';

/**
 * The live run on this ticket, or null (BB-233 AC-8 / its Decision 6). Both signals
 * the detail document already carries are honoured: an included run in
 * `claimed`/`running`, and the ticket's own computed `derived_status` — the latter
 * alone is enough, because a document loaded without its run includes still knows it
 * is being worked on. No extra read.
 */
export function activeRunInfo(
  document: TicketDetailDocument,
): ActiveRunInfo | null {
  const data = document.data;
  const runs = (document.included ?? []).filter(
    (r) => r.type === 'bb_run--bb_run',
  );
  const live = runs.find((r) => ACTIVE_RUN_STATES.has(attr(r, 'state')));
  const derived = attr(data, 'derived_status');
  if (!live && !ACTIVE_RUN_STATES.has(derived)) return null;
  return {
    identifier: attr(data, 'identifier'),
    machine: attr(data, 'claim_machine'),
    runState: live ? attr(live, 'state') : derived,
  };
}
