// BB-360 D5/D9 — edit's Parent autocomplete source: the shared
// `parentOptionSource` (identifier+title match, project scope) with the open
// ticket filtered out of every load. Self-parent is a client-side footgun;
// deeper cycle detection stays server-side.

import type { DropshClient } from '../../../types.js';
import type { OptionSource } from '../../../Widget/index.js';
import type { ParentOption } from './create.js';
import { parentOptionSource } from './parent-source.js';

/**
 * Parent candidates for the edit popup: project-scoped, identifier+title match,
 * excluding `ticketId` so an operator cannot parent a ticket to itself.
 */
export function editParentOptionSource(
  client: DropshClient,
  projectId: string,
  ticketId: string,
): OptionSource<ParentOption> {
  const base = parentOptionSource(client, projectId, 'identifier+title');
  return {
    bag: base.bag,
    ...(base.debounceMs === undefined ? {} : { debounceMs: base.debounceMs }),
    async load(query: string) {
      const outcome = await base.load(query);
      return {
        options: outcome.options.filter((row) => row.id !== ticketId),
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
      };
    },
  };
}
