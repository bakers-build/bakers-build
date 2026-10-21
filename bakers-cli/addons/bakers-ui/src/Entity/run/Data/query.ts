// The run list's criteria — the same shape the ticket list established
// (BB-282 D4, AC-6): criteria type, hasActive, describe, param builder.
// Runs offer only the closed cycle; search/state are not part of BB-282.

import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { LIST_PAGE_SIZE } from '../../cycle.js';
import {
  CONDUCTOR_RUN_TICKET_INCLUDE_FIELDS,
  RUN_LIST_FIELDS,
  RUN_TICKET_INCLUDE_FIELDS,
} from './runs.js';

/** Non-terminal run states — the ONLY states "currently held work" means.
 *  Never `closed`, which tracks something else entirely. */
export const HELD_RUN_STATES = ['claimed', 'running'] as const;

/** The active filter criteria for the project run list. */
export interface RunCriteria {
  /** false: open only (the default) · true: closed only · null: all. */
  closed: boolean | null;
}

/** The shipped default: closed runs hidden (BB-282 D1). */
export const DEFAULT_RUN_CRITERIA: RunCriteria = { closed: false };

/** "Active" means the view is narrowed relative to showing every row —
 *  true at the shipped default, by the same decision as the ticket list. */
export function hasActiveCriteria(criteria: RunCriteria): boolean {
  return criteria.closed !== null;
}

/** Human-readable active-criteria summary, or '' when none. */
export function describeCriteria(criteria: RunCriteria): string {
  if (criteria.closed === null) return '';
  return criteria.closed ? 'closed:only' : 'closed:hidden';
}

/**
 * Build the JSON:API query for a project's runs under the given criteria.
 * Scope is the ticket→project relationship (a project may span conductors).
 * '1'/'0', never the boolean — spec fact 7's measured backend behavior.
 */
export function buildRunQueryParams(
  projectId: string,
  criteria: RunCriteria,
  page: { size: number; index: number } = { size: LIST_PAGE_SIZE, index: 0 },
): DrupalJsonApiParams {
  const params = new DrupalJsonApiParams();
  params.addFilter('ticket_id.project_id.id', projectId);
  applyRunCriteria(params, criteria, page);
  return params;
}

/**
 * Build the JSON:API query for one assignee's runs (BB-377 D2).
 *
 * Runs carry no user of their own — attribution is
 * `ticket_id.assignee_user_id.id`, the same relationship path the reusable
 * `runs` measurement's user binding walks server-side.
 */
export function buildUserRunQueryParams(
  userId: string,
  criteria: RunCriteria,
  page: { size: number; index: number } = { size: LIST_PAGE_SIZE, index: 0 },
): DrupalJsonApiParams {
  const params = new DrupalJsonApiParams();
  params.addFilter('ticket_id.assignee_user_id.id', userId);
  applyRunCriteria(params, criteria, page);
  return params;
}

/** Runs attributed to one member inside the selected team's project set. */
export function buildTeamMemberRunQueryParams(
  userId: string,
  projectIds: string[],
  criteria: RunCriteria,
  page: { size: number; index: number } = { size: LIST_PAGE_SIZE, index: 0 },
): DrupalJsonApiParams {
  const params = new DrupalJsonApiParams();
  params.addFilter('ticket_id.assignee_user_id.id', userId);
  params.addFilter('ticket_id.project_id.id', projectIds, 'IN');
  applyRunCriteria(params, criteria, page);
  return params;
}

/**
 * Build the JSON:API query for one conductor's held work: runs whose
 * `conductor_id` matches and whose state is still non-terminal
 * (claimed/running), newest-started first. Never filters on `closed`.
 */
export function buildConductorRunQueryParams(
  conductorId: string,
  page: { size: number; index: number } = { size: LIST_PAGE_SIZE, index: 0 },
): DrupalJsonApiParams {
  const params = new DrupalJsonApiParams();
  params.addFilter('conductor_id.id', conductorId);
  params.addFilter('state', [...HELD_RUN_STATES], 'IN');
  params.addInclude(['ticket_id']);
  params.addFields(
    'bb_ticket--bb_ticket',
    CONDUCTOR_RUN_TICKET_INCLUDE_FIELDS,
  );
  params.addFields('bb_run--bb_run', RUN_LIST_FIELDS);
  params.addSort('started_at', 'DESC');
  params.addSort('drupal_internal__id', 'DESC');
  params.addPageLimit(page.size);
  if (page.index > 0) params.addPageOffset(page.index * page.size);
  return params;
}

function applyRunCriteria(
  params: DrupalJsonApiParams,
  criteria: RunCriteria,
  page: { size: number; index: number },
): void {
  if (criteria.closed !== null)
    params.addFilter('closed', criteria.closed ? '1' : '0');
  params.addInclude(['ticket_id']);
  // Unlike the ticket list, this fieldset governs the INCLUDES only — the
  // primary type here is `bb_run` (BB-292 D3).
  params.addFields('bb_ticket--bb_ticket', RUN_TICKET_INCLUDE_FIELDS);
  params.addFields('bb_run--bb_run', RUN_LIST_FIELDS);
  params.addSort('started_at', 'DESC');
  params.addSort('drupal_internal__id', 'DESC');
  params.addPageLimit(page.size);
  // Page one carries no offset, so its query is the shortest it can be.
  if (page.index > 0) params.addPageOffset(page.index * page.size);
}
