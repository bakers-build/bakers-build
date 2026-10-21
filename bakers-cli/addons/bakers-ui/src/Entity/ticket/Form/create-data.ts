// BB-236 — the ADAPTER between the data services and the NEW-TICKET popup. The
// division of labour: a data service (`users.ts`, `conductors.ts`, `terms.ts`) returns
// data and knows nothing about forms; this module knows BOTH sides, which is exactly
// its job, and therefore owns the mapping to `Option` and this popup's policy. That
// policy is: the machine's own row first, plain labels, and the collections offered
// as they come — Anonymous kept (verified live: the create ring shows it), every
// conductor kept (a new ticket's project is being chosen in the same popup). Each
// rule has exactly one user, so each is written once, here.
//
// BB-257 (re-entry) AC-12 recast the SHAPE of that job. It used to be one
// function hand-aggregating four bags with `Promise.all` and hand-merging their
// errors, while the Parent field's candidates were ALSO fetched here by a second
// function and debounced, cancelled, swapped and error-merged a third time in the
// kernel. Now each field declares ONE `OptionSource` — the read, the label and
// the error, together — and the generic driver in `src/Widget/option-source.ts`
// primes them, re-queries them and merges them for every field alike. The popup's
// policy is unchanged and still lives here; only the plumbing left.

import type { DropshClient } from '../../../types.js';
import {
  type OptionSource,
  type OptionSources,
  primeSources,
} from '../../../Widget/index.js';
import { listConductorsForProject } from '../../conductor/Data/conductors.js';
import { listTerms } from '../../term/Data/terms.js';
import { listTemplatesForProject } from '../../ticket-template/Data/templates.js';
import { listUsers } from '../../user/Data/users.js';
import {
  type CreateFormOptions,
  type CreateOptionErrors,
  WORKFLOW_OPTIONS,
} from './create.js';
import { parentOptionSource } from './parent-source.js';
import { projectOptionSource } from './project-source.js';
import { loadReviewerOptions } from './reviewer-options.js';

// One back-compat re-export, no implementation: `loadEditFormOptions` lives in
// `./edit-form-data.js`, because a module named for the create form owning the EDIT
// form's loader is the category error AC-6 is about.
export {
  type EditFormClients,
  type EditFormHints,
  loadEditFormOptions,
} from './edit-data.js';
// The parent label policy moved to `parent-source.ts` with the source (BB-284
// D5); re-exported so the existing import site keeps working unchanged.
export { parentLabel } from './parent-source.js';

/** Hints from the launcher used to preselect the machine's own user + conductor. */
export interface CreateFormHints {
  currentUser?: string | undefined;
  ownConductorMachineId?: string | undefined;
  /**
   * The project the parent candidates are scoped to (BB-257 D8).
   *
   * `n` is a global key — the popup also opens from the dashboard, where no
   * project is selected. Absent ⇒ the Parent field declares NO source, so no
   * candidate read is attempted, the bag stays ABSENT, and the field renders
   * "no project context". Resolving a fallback slug to a uuid with an extra
   * request is deliberately not done: it would add a failure mode to the only
   * path where the popup is already working from a guess.
   */
  projectId?: string | undefined;
  /** The launcher's user uuid; hoists everything the machine's user owns (BB-460). */
  ownerUserId?: string | undefined;
  /** Workspace UUID for the Reviewers bag (membership ∩ users). */
  workspaceId?: string | undefined;
}

/**
 * Stable-partition the machine's own row to the front: index 0 is what a ring
 * defaults to. This popup's only ordering rule, and it reads the same for users and
 * conductors — only what counts as "own" differs, which the caller passes in.
 */
export const ownFirst = <T>(rows: T[], isOwn: (row: T) => boolean): T[] => [
  ...rows.filter(isOwn),
  ...rows.filter((row) => !isOwn(row)),
];

/** Every collection reaches this popup as a plain `{id, label}` picker row. */
const toOption = (row: {
  id: string;
  label: string;
}): {
  id: string;
  label: string;
} => ({ id: row.id, label: row.label });

/**
 * The vocabulary this popup offers as its labels (BB-257 D3).
 *
 * The policy lives HERE and not in `terms.ts`, for the same reason own-first does:
 * the data service returns terms for whatever purpose, and which of the entity
 * type's vocabularies a given widget wants is the widget's business.
 */
const LABEL_VOCABULARY = 'bb_labels';

/**
 * The `conductors` option source for one (possibly absent) project.
 *
 * Extracted from `createFormSources` (BB-664 AC-8) so the screen can call it
 * a SECOND time, scoped to whatever project the operator just picked in the
 * new Project field — the only way the Conductor bag can re-scope without a
 * second, hand-written read living beside this one.
 */
export function conductorOptionSource(
  client: DropshClient,
  hints: Pick<
    CreateFormHints,
    'projectId' | 'ownerUserId' | 'ownConductorMachineId'
  >,
): OptionSource {
  const { projectId, ownerUserId, ownConductorMachineId } = hints;
  return {
    bag: 'conductors',
    async load() {
      // BB-664 review F4: a new ticket's project scopes the conductor
      // candidates the same way the Web dialog's selection handler does —
      // including offering NONE without a resolved project, since the
      // server now rejects a conductor assignment on a projectless ticket
      // the same way it rejects a cross-project one.
      if (projectId === undefined) {
        return { options: [] };
      }
      const outcome = await listConductorsForProject(client, projectId);
      const assignable = outcome.rows.filter((c) => c.active);
      // Two stable partitions, strongest LAST (BB-460 D8): everything I own
      // rises above everyone else's, then this checkout's record rises above
      // the rest of mine. Applied in the other order the weaker rule would
      // scatter what the stronger one just gathered.
      const byOwner = ownerUserId
        ? ownFirst(assignable, (c) => c.ownerUserId === ownerUserId)
        : assignable;
      const rows = ownConductorMachineId
        ? ownFirst(byOwner, (c) => c.machineId === ownConductorMachineId)
        : byOwner;
      return { options: rows.map(toOption), error: outcome.error };
    },
  };
}

/** The `templates` option source for one project and its workspace. */
export function templateOptionSource(
  client: DropshClient,
  projectId: string,
  workspaceId?: string,
): OptionSource {
  return {
    bag: 'templates',
    async load() {
      const outcome = await listTemplatesForProject(
        client,
        projectId,
        workspaceId,
      );
      return { options: outcome.rows.map(toOption), error: outcome.error };
    },
  };
}

/**
 * The option sources this popup's fields load through, keyed by FIELD id.
 *
 * The one place each bag is obtained (AC-12): the read, the mapping to `Option`
 * and the error travel together, so the preloaded page and every debounced
 * re-query can never label a row two ways or report a failure differently.
 *
 * The Parent source is the only one with a `debounceMs`, and that is the whole
 * of "which fields re-query as you type": a source without one is primed once
 * and filtered locally, which is what a fixed ring wants.
 *
 * Three rules together are what make its suggestion list trustworthy (D7), and
 * they are stated here because this is the only place all three are visible:
 *
 *   1. one project-scoped page is preloaded at open — `composeCreateFormOptions`
 *      calls every source with the EMPTY query — so ←/→ works before a character
 *      is typed;
 *   2. a change to the query re-queries the server, DEBOUNCED, so a match beyond
 *      that first page is still reachable;
 *   3. the WIDGET always applies the kernel's own local substring filter over
 *      whatever bag is present. So between a keystroke and its response the list
 *      can lag, but it can never show a row contradicting the text on screen.
 */
export function createFormSources(
  client: DropshClient,
  hints: CreateFormHints = {},
): OptionSources {
  const {
    currentUser,
    ownConductorMachineId,
    ownerUserId,
    projectId,
    workspaceId,
  } = hints;
  const sources: Record<string, OptionSource> = {
    assignee: {
      bag: 'users',
      async load() {
        const outcome = await listUsers(client);
        // The launcher may know the machine's user by username or by uuid.
        const rows = currentUser
          ? ownFirst(
              outcome.rows,
              (u) => u.name === currentUser || u.id === currentUser,
            )
          : outcome.rows;
        return { options: rows.map(toOption), error: outcome.error };
      },
    },
    reviewers: {
      bag: 'reviewers',
      async load() {
        return loadReviewerOptions(client, workspaceId);
      },
    },
    conductor: conductorOptionSource(client, {
      projectId,
      ownerUserId,
      ownConductorMachineId,
    }),
    labels: {
      bag: 'labels',
      async load() {
        const outcome = await listTerms(client, LABEL_VOCABULARY);
        return { options: outcome.rows.map(toOption), error: outcome.error };
      },
    },
  };
  // No project in scope ⇒ NO source, so the bag stays absent rather than empty:
  // "nothing can be offered" and "searched, nothing matched" are different
  // things and the field says different things about them (D8).
  if (projectId !== undefined) {
    // The shared parent source (BB-284 D5): the same read, label policy and
    // error channel the parent-filter picker composes.
    sources.parent = parentOptionSource(client, projectId);
    sources.template = templateOptionSource(client, projectId, workspaceId);
  } else {
    // BB-664 AC-8: no project in scope ⇒ the popup offers a Project field
    // instead of refusing outright, over the SAME source the project-filter
    // picker searches with (`projectOptionSource`) — never a second read.
    sources.project = projectOptionSource(client);
  }
  return sources;
}

/**
 * Prime every declared source into the popup's option object.
 *
 * `workflows` is a fixed enum, not a read, so it is not a source and cannot
 * fail. The preload uses the EMPTY query, so ←/→ browses the project's most
 * recently changed tickets before a single character is typed (D7).
 */
export async function composeCreateFormOptions(
  sources: OptionSources,
): Promise<CreateFormOptions> {
  const { bags, errors } = await primeSources(sources);
  return {
    users: [],
    reviewers: [],
    conductors: [],
    labels: [],
    workflows: WORKFLOW_OPTIONS,
    // Spread over the defaults, so a bag with no source stays ABSENT (D8) while
    // a declared one wins even when it came back empty.
    //
    // The cast restores what the generic driver erases: `OptionSources` is keyed
    // by field and typed over the base `Option`, so the driver hands back
    // `Option[]` per bag — but the Parent source is declared
    // `satisfies OptionSource<ParentOption>` above, so those rows really do carry
    // `identifier` and `title`, which is what `toObject` reads for the payload.
    ...(bags as Partial<CreateFormOptions>),
    // Only the keys of bags that actually failed, and the whole object only when
    // there is at least one — so "no errors" is the ABSENCE of the key, which is
    // what lets every pre-BB-257 fixture stay valid unchanged. The keys ARE
    // the bag keys, which is what `CreateOptionErrors` declares.
    ...(Object.keys(errors).length > 0
      ? { errors: errors as CreateOptionErrors }
      : {}),
  };
}

export async function loadCreateFormOptions(
  client: DropshClient,
  hints: CreateFormHints = {},
): Promise<CreateFormOptions> {
  return composeCreateFormOptions(createFormSources(client, hints));
}
