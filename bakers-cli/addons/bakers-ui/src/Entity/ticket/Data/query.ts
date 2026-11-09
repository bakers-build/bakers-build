import { DrupalJsonApiParams } from 'drupal-jsonapi-params';

/** A picked parent ticket: the uuid the query filters by, plus the identifier the summary names. */
export interface ParentCriterion {
  /** The parent's uuid — what the query filters by. */
  id: string;
  /** `BB-nnn` — what the summary names (AC-2), carried so no lookup is needed. */
  identifier: string;
}

/** A picked user: the uuid the query filters by, plus the name the summary names. */
export interface WhoCriterion {
  /** The user's uuid — what the query filters by. */
  id: string;
  /** The display name — what the summary names, carried so no lookup is needed. */
  label: string;
}

/** A picked project: the uuid the query filters by, plus the name the summary names. */
export interface ProjectCriterion {
  /** The project's uuid — what the query filters by. */
  id: string;
  /** The project name — what the summary names, carried so no lookup is needed. */
  label: string;
}

/** The active search + filter criteria for the project ticket list. */
export interface TicketCriteria {
  query: string;
  state: string | null;
  /** false: open only (the default) · true: closed only · null: all. */
  closed: boolean | null;
  /**
   * Direct children of this ticket only (spec question 3). `null` means "all";
   * "no parent" (top-level tickets) is deliberately not expressible — core
   * JSON:API has no IS NULL relationship filter (spec question 2).
   */
  parent: ParentCriterion | null;
  /** Tickets assigned to this user only (BB-299 D3); `null` means "all". */
  who: WhoCriterion | null;
  /**
   * Tickets owned (created) by this user only (BB-416); `null` means "all".
   * Independent of `who` — both can be set at once, and each ANDs with the
   * other exactly as they each AND with `parent`/`state`. Filters on
   * `owner_user_id.id` directly; this is unrelated to the web-UI's `owner`
   * exposed-Views facet, which the TUI never queries through.
   */
  owner: WhoCriterion | null;
  /** Tickets in this project only (BB-540); `null` means "all". */
  project: ProjectCriterion | null;
}

/** The shipped default: everything unset, closed rows hidden (BB-282 D1). */
export const DEFAULT_TICKET_CRITERIA: TicketCriteria = {
  query: '',
  state: null,
  closed: false,
  parent: null,
  who: null,
  owner: null,
  project: null,
};

// The cycle mechanism lives in `Entity/cycle.ts` (slice-less, so both the
// ticket and the run slice can import it without closing the G1 cycle);
// re-exported here so the import sites BB-282 established against this module
// keep working (`Screen/tickets.ts` imports both from here).
//
// `LIST_PAGE_SIZE` is deliberately NOT re-exported: it is new in BB-292 and
// has no established import site to preserve — measured, every consumer reaches
// `../../cycle.js` directly, including this module's own `PAGE_SIZE` alias below.
export { CLOSED_FILTER_VALUES, cycleValue } from '../../cycle.js';

import { LIST_PAGE_SIZE as PAGE_SIZE } from '../../cycle.js';
import {
  TICKET_CONDUCTOR_INCLUDE_FIELDS,
  TICKET_LIST_FIELDS,
} from './tickets.js';

// Ticket states from web/modules/custom/bb_core/bb_core.workflows.yml
// (the `bb_work` workflow) plus the import/backlog states seen on tickets.
// Hardcoded so the cycle is deterministic and independent of the loaded page.
export const STATE_FILTER_VALUES: string[] = [
  'triage',
  'backlog',
  'todo',
  'plan',
  'working',
  'review',
  'done',
  'cancelled',
];

/** "Active" means the view is narrowed relative to showing every row —
 *  true at the shipped default, which hides closed rows (BB-282 D2). */
export function hasActiveCriteria(criteria: TicketCriteria): boolean {
  return (
    Boolean(criteria.query) ||
    criteria.state != null ||
    criteria.closed !== null ||
    criteria.parent != null ||
    criteria.who != null ||
    criteria.owner != null ||
    criteria.project != null
  );
}

/** Human-readable active-criteria summary, or '' when none. */
export function describeCriteria(criteria: TicketCriteria): string {
  const parts: string[] = [];
  if (criteria.query) parts.push(`search:"${criteria.query}"`);
  if (criteria.state) parts.push(`status:${criteria.state}`);
  // The label, never the uuid.
  if (criteria.who) parts.push(`who:${criteria.who.label}`);
  if (criteria.owner) parts.push(`owner:${criteria.owner.label}`);
  if (criteria.closed !== null)
    parts.push(criteria.closed ? 'closed:only' : 'closed:hidden');
  // The identifier, never the uuid (AC-2).
  if (criteria.parent) parts.push(`parent:${criteria.parent.identifier}`);
  if (criteria.project) parts.push(`project:${criteria.project.label}`);
  return parts.join(' · ');
}

/** How a caller narrows the shared builder (BB-292 D1/D8). */
export interface TicketQueryOptions {
  /** Rows per page + which page. Defaults to the list's own `LIST_PAGE_SIZE`
   *  (20 since the operator's live review, D6a), first page. */
  page?: { size: number; index: number };
  /** Sideload parent_id + conductor_id for the PARENT/COND columns. Default true;
   *  the parent picker passes false because it renders neither (D8). */
  includes?: boolean;
  /** Apply criteria.project as a filter. Default false; set true in
   *  buildUserTicketQueryParams so My work can narrow by project (BB-540). */
  projectFromCriteria?: boolean;
}

/**
 * Build the JSON:API query for a project's tickets under the given criteria.
 * project + state + closed + parent + who are AND filters at the top level; the
 * free-text search is one `filter[search]` the server looks up on the ticket index.
 */
export function buildTicketQueryParams(
  projectId: string,
  criteria: TicketCriteria,
  options: TicketQueryOptions = {},
): DrupalJsonApiParams {
  const params = new DrupalJsonApiParams();
  params.addFilter('project_id.id', projectId);
  applyTicketCriteria(params, criteria, options);
  return params;
}

/**
 * Build the JSON:API query for one assignee's tickets (BB-377 D2).
 *
 * Same paging, fieldset and closed-filter cycle as the project builder; the
 * scope is `assignee_user_id.id` instead of `project_id.id`.
 */
export function buildUserTicketQueryParams(
  userId: string,
  criteria: TicketCriteria,
  options: TicketQueryOptions = {},
): DrupalJsonApiParams {
  const params = new DrupalJsonApiParams();
  params.addFilter('assignee_user_id.id', userId);
  applyTicketCriteria(params, criteria, {
    ...options,
    projectFromCriteria: true,
  });
  return params;
}

/**
 * Build the JSON:API query for the tickets assigned to one conductor —
 * open only, newest-changed first. Not project-scoped: a conductor may serve
 * more than one project.
 */
export function buildConductorTicketQueryParams(
  conductorId: string,
  page: { size: number; index: number } = { size: PAGE_SIZE, index: 0 },
  query = '',
): DrupalJsonApiParams {
  const params = new DrupalJsonApiParams();
  params.addFilter('conductor_id.id', conductorId);
  params.addFilter('closed', '0');
  // The `/` line, resolved server-side exactly as on the project list.
  if (query) params.addFilter('search', query);
  params.addInclude(['parent_id', 'conductor_id']);
  params.addFields(
    'bb_conductor--bb_conductor',
    TICKET_CONDUCTOR_INCLUDE_FIELDS,
  );
  params.addFields('bb_ticket--bb_ticket', TICKET_LIST_FIELDS);
  params.addSort('changed', 'DESC');
  params.addSort('drupal_internal__id', 'DESC');
  params.addPageLimit(page.size);
  if (page.index > 0) params.addPageOffset(page.index * page.size);
  return params;
}

function applyTicketCriteria(
  params: DrupalJsonApiParams,
  criteria: TicketCriteria,
  options: TicketQueryOptions,
): void {
  // The typed line goes to the server verbatim. The collection looks it up in
  // the same ticket index the web list uses and filters by the matching ids.
  if (criteria.query) params.addFilter('search', criteria.query);
  if (criteria.state) params.addFilter('state', criteria.state);
  // '1'/'0', never the boolean: the backend's integer-backed boolean storage
  // matches OPEN rows for filter[closed]=true (measured, spec fact 7).
  if (criteria.closed !== null)
    params.addFilter('closed', criteria.closed ? '1' : '0');
  // Direct children only; top level, so it ANDs with project/state while
  // the search stays untouched (AC-5).
  if (criteria.parent) params.addFilter('parent_id.id', criteria.parent.id);
  // Assigned to this user only; a top-level AND like parent, never part of
  // the search (BB-299 AC-4). Skipped when the builder itself is
  // already scoped to an assignee (user ticket list).
  if (criteria.who) params.addFilter('assignee_user_id.id', criteria.who.id);
  // Owned by (created by) this user only; a top-level AND like who/parent,
  // never part of the search (BB-416). `owner_user_id` is the
  // entity's owner key — see `ticket-detail/index.ts` — and is unrelated to
  // the web-UI's `owner` exposed-Views facet.
  if (criteria.owner) params.addFilter('owner_user_id.id', criteria.owner.id);
  // Filter by project; applied only when projectFromCriteria is true (BB-540).
  if (options.projectFromCriteria && criteria.project)
    params.addFilter('project_id.id', criteria.project.id);
  const { size, index } = options.page ?? { size: PAGE_SIZE, index: 0 };
  // Sideload the parent ticket + assigned conductor so the row can render the
  // parent identifier / conductor label from `included` (BB-193, AC-5).
  if (options.includes !== false) {
    params.addInclude(['parent_id', 'conductor_id']);
    params.addFields(
      'bb_conductor--bb_conductor',
      TICKET_CONDUCTOR_INCLUDE_FIELDS,
    );
  }
  // ONE fieldset serves both jobs: it applies to the primary rows AND to the
  // sideloaded parent tickets, which are the same JSON:API type and need only
  // `identifier` — already in the set (BB-292 D3).
  params.addFields('bb_ticket--bb_ticket', TICKET_LIST_FIELDS);
  params.addSort('changed', 'DESC');
  params.addSort('drupal_internal__id', 'DESC');
  params.addPageLimit(size);
  // Page one carries no offset, so its query is the shortest it can be.
  if (index > 0) params.addPageOffset(index * size);
}
