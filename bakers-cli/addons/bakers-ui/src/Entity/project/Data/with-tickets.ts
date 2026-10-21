// Resolving ONE project by slug together with its ticket rows. The project half of
// the former `Service/project-data.ts` (BB-236 phase 3).
//
// This is one of exactly two enumerated `project/Data -> ticket/Data` edges the
// boundary guard allows: the ticket listing deliberately delegates to
// `loadFilteredTickets` so the search/filter path and this one resolve
// parent/conductor through the same mapper, with no dual-mapper drift.

import type { DropshClient } from '../../../types.js';
import {
  loadFilteredTickets,
  type TicketRow,
} from '../../ticket/Data/tickets.js';
import { resolveProject } from './project.js';

/** The resolved project header + its ticket rows. */
export interface ProjectWithTickets {
  project: { id: string; name: string; slug: string };
  tickets: TicketRow[];
}

/**
 * Resolve a `bb_project` by its slug (the registry `project`, which matches
 * the project's `name`) and list its tickets, most-recently-changed first.
 *
 * The ticket listing delegates to {@link loadFilteredTickets} with empty
 * criteria — one include-aware `client.get` path shared with the search/filter
 * load, so both resolve parent/conductor identically (no dual-mapper drift).
 *
 * It takes the loader's FIRST page and drops the `hasNext` beside it (BB-292):
 * this read has no paging affordance of its own — it is the overview header's
 * ticket bag, not the paged Tickets tab — so the flag has no consumer here and
 * carrying it would imply a control that does not exist.
 */
export async function loadProjectWithTickets(
  client: DropshClient,
  projectSlug: string,
): Promise<ProjectWithTickets> {
  const project = await resolveProject(client, projectSlug);
  const page = await loadFilteredTickets(client, project.id, {
    query: '',
    state: null,
    // closed: null — this is the project overview read, not the ticket list;
    // it keeps "show everything" (spec D6).
    closed: null,
    parent: null,
    who: null,
    owner: null,
    project: null,
  });
  return {
    project,
    tickets: page.rows,
  };
}
