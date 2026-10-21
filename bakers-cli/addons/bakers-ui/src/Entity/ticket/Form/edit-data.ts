// BB-236 — the ADAPTER between the data services and the EDIT popup, and a sibling
// of `loadCreateFormOptions` rather than a parameterisation of it. A data service
// (`users.ts`, `conductors.ts`, `terms.ts`) returns data and knows nothing about forms;
// this module knows both sides and therefore owns the mapping to `Option` and this
// popup's policy: read write-client-first for users/conductors, drop Anonymous, filter
// conductors to the ticket's project, put liveness in the label, load the
// `bb_labels` vocabulary for the Labels multi-select, and reorder ONLY the
// conductor ring owner-first (BB-460) — the assignee ring is unordered because
// the popup preselects the ticket's current assignee. Each rule has exactly one
// user, so each is written once, here, beside the create adapter it differs from.
//
// BB-360: labels bag replaces the constant State select targets. Parent typeahead
// is an OptionSource on the screen, not a batch bag here.

import type { Option } from '../../../Form/index.js';
import {
  type Conductor,
  listConductorsPreferringWrite,
} from '../../conductor/Data/conductors.js';
import { listTerms } from '../../term/Data/terms.js';
import type { OptionClients } from '../../transport.js';
import { listUsersPreferringWrite, type User } from '../../user/Data/users.js';
import { ownFirst } from './create-data.js';
import type { EditFormOptions } from './edit.js';
import { loadReviewerOptions } from './reviewer-options.js';

/** The two clients an edit-options load may use, by role. */
export type EditFormClients = OptionClients;

export interface EditFormHints {
  /** The ticket's project; conductors are filtered to it. */
  projectId?: string | undefined;
  /** The launcher's user uuid; hoists everything the machine's user owns (BB-460). */
  ownerUserId?: string | undefined;
  /** Workspace UUID for the Reviewers bag (membership ∩ users). */
  workspaceId?: string | undefined;
}

/** The vocabulary this popup offers as its labels (BB-360 D9 / D11). */
const LABEL_VOCABULARY = 'bb_labels';

/**
 * uid 0 is Drupal's Anonymous and never a valid human assignee. A row whose uid never
 * loaded is `undefined` — NOT Anonymous — and stays.
 */
const excludeAnonymous = (users: User[]): User[] =>
  users.filter((u) => u.uid !== 0);

/**
 * `conductor_id` carries BbConductorProjectMatch, so an out-of-project conductor is
 * a guaranteed 422. No project id ⇒ no filter.
 */
const inProject = (
  conductors: Conductor[],
  projectId: string | undefined,
): Conductor[] =>
  projectId ? conductors.filter((c) => c.projectId === projectId) : conductors;

/**
 * `… (status)`, so handing work to an offline conductor is a visible choice rather
 * than an accident. Nothing to add when there is no status to add.
 */
const withStatusSuffix = (c: Conductor): Option => ({
  id: c.id,
  label: c.status ? `${c.label} (${c.status})` : c.label,
});

export async function loadEditFormOptions(
  clients: EditFormClients,
  hints: EditFormHints = {},
): Promise<EditFormOptions> {
  // Labels have no write-preferring helper: terms are not write-gated the way
  // assignees/conductors are. Fail-open to [] when the read client is absent or
  // the vocabulary throws (D11).
  const labelsPromise = clients.read
    ? listTerms(clients.read, LABEL_VOCABULARY).then(
        (outcome) =>
          outcome.rows.map((t) => ({ id: t.id, label: t.label })) as Option[],
        () => [] as Option[],
      )
    : Promise.resolve([] as Option[]);

  const reviewerClient = clients.write ?? clients.read;
  const reviewersPromise = reviewerClient
    ? loadReviewerOptions(reviewerClient, hints.workspaceId)
    : Promise.resolve({
        options: [] as Option[],
        error: 'no client — reviewers cannot be loaded',
      });

  const [users, conductors, labels, reviewers] = await Promise.all([
    listUsersPreferringWrite(clients),
    listConductorsPreferringWrite(clients),
    labelsPromise,
    reviewersPromise,
  ]);
  return {
    users: excludeAnonymous(users).map((u) => ({ id: u.id, label: u.label })),
    reviewers: reviewers.options,
    conductors: ownFirst(
      inProject(conductors, hints.projectId).filter((c) => c.active),
      (c) =>
        hints.ownerUserId !== undefined && c.ownerUserId === hints.ownerUserId,
    ).map(withStatusSuffix),
    labels,
    ...(reviewers.error === undefined
      ? {}
      : { errors: { reviewers: reviewers.error } }),
  };
}
