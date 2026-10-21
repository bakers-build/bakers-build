// Form-layer adapter: the Reviewers option bag is membership ∩ users.
// Data services stay form-ignorant; this module owns the intersection, the
// Anonymous drop, and the reviewer-specific error. Never falls back to the
// instance-wide user list.

import type { Option } from '../../../Form/index.js';
import type { DropshClient } from '../../../types.js';
import { listAllUsers } from '../../user/Data/users.js';
import { loadWorkspaceMemberships } from '../../workspace/Data/members.js';

export const NO_WORKSPACE_REVIEWERS_ERROR =
  'no workspace in scope — reviewers cannot be loaded';

export interface ReviewerOptionOutcome {
  options: Option[];
  error?: string | undefined;
}

const toOption = (row: { id: string; label: string }): Option => ({
  id: row.id,
  label: row.label,
});

/** Selected ids that are not in the bag stay visible/removable. */
export function withSelectedReviewers(
  bag: Option[],
  selected: Iterable<string>,
  labels: ReadonlyMap<string, string> = new Map(),
): Option[] {
  const known = new Set(bag.map((option) => option.id));
  const extra: Option[] = [];
  for (const id of selected) {
    if (known.has(id)) continue;
    extra.push({ id, label: labels.get(id) ?? id });
  }
  return extra.length === 0 ? bag : [...bag, ...extra];
}

export async function loadReviewerOptions(
  client: DropshClient,
  workspaceId: string | undefined,
): Promise<ReviewerOptionOutcome> {
  if (!workspaceId) {
    return { options: [], error: NO_WORKSPACE_REVIEWERS_ERROR };
  }
  try {
    const [memberships, users] = await Promise.all([
      loadWorkspaceMemberships(client, workspaceId),
      listAllUsers(client),
    ]);
    if (users.error) {
      return { options: [], error: users.error };
    }
    const memberIds = new Set(memberships.memberIds);
    return {
      options: users.rows
        .filter((user) => memberIds.has(user.id) && user.uid !== 0)
        .map(toOption),
    };
  } catch (caught) {
    return {
      options: [],
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
