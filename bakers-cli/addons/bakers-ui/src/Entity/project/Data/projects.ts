import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { humanizeAge } from '../../../lib/format.js';
import type { DropshClient, JsonApiRelationship } from '../../../types.js';
import type { JsonApiCollectionDoc, ListTable } from '../../collection.js';
import {
  type ConductorStatus,
  deriveConductorStatus,
} from '../../conductor/Data/liveness.js';

/** JSON:API timestamps arrive as ISO-8601 strings; liveness works in seconds. */
function toEpochSeconds(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Id of a single-valued relationship linkage (`data` object), or null. */
function singleRelId(rel: JsonApiRelationship | undefined): string | null {
  const data = rel?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

// Most-alive-first ranking so a project with several conductors reports its
// liveliest one, not whichever the collection happened to return first.
const STATUS_RANK: Record<ConductorStatus, number> = {
  online: 0,
  stale: 1,
  offline: 2,
  'registry-only': 3,
};

/** A derived project row: one distinct project + its liveliest conductor. */
export interface ProjectRow {
  project: string;
  /**
   * The `bb_project` uuid — what every node of this row is keyed on.
   *
   * BB-345 renamed it from `projectId`: `ListTable` reads row identity as
   * `rowNodeId(table.noun, row.id)` for every list, so the field carries the one
   * name that identity is read from. Adding an `id` BESIDE `projectId` would
   * have been the same value under two names in the same object — precisely the
   * drift D2 exists to make unrepresentable — and the route param that consumes
   * it still spells itself `projectId`, which is the caller's vocabulary.
   */
  id: string;
  projectName: string;
  projectSlug: string;
  derivedStatus: ConductorStatus;
  lastSeen: number | null;
  ageLabel: string;
}

/**
 * The projects list, declared once (BB-345 D2/D10) — its columns, the noun
 * every one of its node ids is prefixed with, and what it says when it is empty.
 *
 * It GAINED A HEADER with this ticket (D6, an operator decision). Three
 * unlabelled columns were readable because there are three of them, and "a list
 * has a header" is worth more than that accident. The consequence is stated
 * because it is a behaviour change: the list grows one row at the top and its
 * selection highlight moves down one physical row. Nothing computes that offset
 * — selection is a node attribute and the cursor is found through `rowIds`,
 * both of which BB-340 made position-free.
 *
 * `Ctx` is `void`, and that is a correction to the plan's sketch made on the
 * tree: the sketch threaded `nowSeconds` so the AGE column could call
 * `humanizeAge` per render, as the run list does. This loader has already called
 * it — `ageLabel` is a member of {@link ProjectRow}, computed once against the
 * `now` the read used — so threading a second clock in would either recompute
 * from a different one or leave two answers in the row. The column reads what
 * the loader derived.
 *
 * `fields` names what each column is built from, as everywhere. The loader is a
 * different shape here — it reads the whole `bb_conductor` collection with no
 * sparse fieldset, so there is no `AssertExhaustive` proof to bind these to —
 * and declaring them anyway is what keeps that a fact about this loader rather
 * than a hole in the column model.
 */
export const PROJECT_TABLE = {
  noun: 'project',
  emptyMessage: 'No projects.',
  columns: [
    {
      /**
       * FREE TEXT, and therefore THE GROWER of this list (BB-345 AC 5) — an
       * operator decision taken after Task 5 first shipped it as a fixed 24.
       *
       * THE TRADE, STATED WHOLE, because it was taken knowingly.
       *
       * What is GAINED: the row uses the width it is given. Measured at 160
       * columns, a fixed 24 cut an ordinary project name while the trailing AGE
       * held ~120 columns of whitespace — the ticket's own finding 3 reproduced
       * on this list, and a real gap against AC 5. A `width: 0` column declared
       * FIRST takes that surplus and leaves STATUS and AGE their budgets, with
       * the column ORDER unchanged: `flexGrow` is a property of the cell, not of
       * its position, so the grower does not have to be last (measured on a real
       * renderer, `tests-bun/Screen/list-table-layout.test.ts`).
       *
       * What is PAID: {@link cellText} cannot mark this column's cut. It
       * measures against the width the column DECLARES, and a grower declares
       * none — only Yoga knows the width the row resolved to. The renderer's own
       * `truncate` appends nothing: `@opentui/core@0.5.1` has no ellipsis option
       * at all, only `truncate?: boolean` (verified in its typings). So a name
       * long enough to outgrow the whole terminal is cut silently.
       *
       * The operator took that trade because the two costs are not the same
       * size: a cut only becomes necessary at absurd lengths once the column
       * grows, and it is the same behaviour class the ticket list's TITLE
       * already has, whereas a fixed 24 cut a perfectly ordinary project name
       * every single time.
       *
       * No `min`, for the reason the ticket list's TITLE gives: a floor is a
       * floor the row cannot meet on a narrow terminal, and an unmeetable
       * minimum pushes the row past the right edge.
       */
      key: 'name',
      label: 'PROJECT',
      width: 0,
      fields: ['name'],
      get: (row: ProjectRow) => row.projectName,
    },
    {
      /**
       * A CLOSED VOCABULARY, and deliberately unbounded for that reason — the
       * same shape of argument the run list's STATE gives.
       *
       * `ConductorLiveness` is `online | stale | offline` (BB-450 D11 renamed
       * the fresh state from `running`; the `registry-only` fourth state went
       * with the local registry), whose longest member is 7 characters, so the
       * width of 14 this column has always had shows every one of them whole
       * with room to spare. A `max` would be a constant nobody reads and a
       * `grow` would have nothing left to reach.
       */
      key: 'status',
      label: 'STATUS',
      width: 14,
      fields: ['status', 'lease_expires_at'],
      get: (row: ProjectRow) => row.derivedStatus,
    },
    {
      /**
       * A FIXED budget sized to its own vocabulary, which is what it gives up
       * the trailing-grower role for (BB-345 AC 5).
       *
       * It used to be the column that took the row's surplus, and that is
       * exactly the defect the correction above removes: AGE cannot USE a
       * surplus, because everything it can ever say is short. `humanizeAge`
       * emits `—`, `just now`, `<n>m ago`, `<n>h ago` or `<n>d ago`, and 8 is
       * the longest of them — `just now`, matched by a three-digit day count
       * (`999d ago`, ~2.7 years since the last heartbeat). A DOMAIN constant
       * read off that function's own vocabulary, never a measurement of the
       * page (spec D4).
       *
       * A four-digit day count would be cut, and it would SAY so: this column
       * declares a width, so `cellText` has something to measure against and
       * appends its ellipsis. That is the half of the trade the grower above
       * gives up, kept here where it costs nothing.
       */
      key: 'age',
      label: 'AGE',
      width: 8,
      fields: ['last_seen'],
      get: (row: ProjectRow) => row.ageLabel,
    },
  ],
} as const satisfies ListTable<ProjectRow, void>;

/**
 * Resolve the projects screen's rows straight from the control plane: list the
 * `bb_conductor` entities (read is owner-gated, so this is already scoped to
 * the current user's conductors — no local registry needed), sideload their
 * `project_id`, group by project name, and report each project's liveliest
 * conductor (online > stale > offline). Everything is a Drupal entity read
 * through `services.client` (AC-5); the screen itself stays a screen/route.
 */
export async function loadProjectRows({
  client,
  nowSeconds,
}: {
  client: DropshClient;
  nowSeconds: () => number;
}): Promise<ProjectRow[]> {
  const params = new DrupalJsonApiParams().addInclude(['project_id']);
  let doc: JsonApiCollectionDoc;
  try {
    doc = (await client.get(
      'bb_conductor/bb_conductor',
      params,
    )) as JsonApiCollectionDoc;
  } catch {
    return [];
  }

  // Resolve each conductor's project name from the sideloaded bb_project.
  const projectNameById = new Map<string, string>();
  for (const inc of doc.included ?? []) {
    if (inc.id && typeof inc.attributes?.name === 'string') {
      projectNameById.set(inc.id, inc.attributes.name);
    }
  }

  const now = nowSeconds();
  const best = new Map<
    string,
    { derivedStatus: ConductorStatus; lastSeen: number | null }
  >();
  for (const c of doc.data ?? []) {
    const a = c.attributes ?? {};
    const projectId = singleRelId(c.relationships?.project_id);
    const project = projectId ? projectNameById.get(projectId) : undefined;
    // A conductor whose project cannot be resolved is not a project row.
    if (!project) continue;
    const lastSeen = toEpochSeconds(a.last_seen ?? null);
    const derivedStatus = deriveConductorStatus(
      {
        present: true,
        status: typeof a.status === 'string' ? a.status : null,
        lastSeen,
        leaseExpiresAt: toEpochSeconds(a.lease_expires_at ?? null),
      },
      now,
    );
    const prev = best.get(project);
    if (!prev || STATUS_RANK[derivedStatus] < STATUS_RANK[prev.derivedStatus]) {
      best.set(project, { derivedStatus, lastSeen });
    }
  }

  return [...best.entries()].map(([project, b]) => ({
    project,
    id:
      [...projectNameById.entries()].find(
        ([, name]) => name === project,
      )?.[0] ?? project,
    projectName: project,
    projectSlug: project,
    derivedStatus: b.derivedStatus,
    lastSeen: b.lastSeen,
    ageLabel: humanizeAge(b.lastSeen, now),
  }));
}
