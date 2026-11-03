// BB-232 (spec Decision D9) — "which conductor is THIS checkout's?", answered
// from the control plane instead of the deleted `~/.bakers/conductors.json`.
//
// A conductor is machine + project + variant. The `bakers ui` entry
// hands over the `.bakers` dir it is standing in; the renderer reads this
// machine's conductors (filtered by `machine.id`), keeps the ones whose
// `workspace_root` is this checkout, and prefers the default variant
// (`conductor`). The record supplies the project and the conductor's UUID, which
// preselect fields in the new-ticket form.
//
// The path rule is an exact, normalised comparison, never a longest-prefix walk:
// a worktree — which has its own `.bakers` — resolves to no conductor rather
// than quietly inheriting its parent checkout's project. `workspace_root` holds
// the checkout root (BB-450 D3); a record still carrying the legacy `.bakers`
// value matches too.
import { dirname, resolve } from 'node:path';
import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { DropshClient, JsonApiRelationship } from '../../../types.js';
import type { JsonApiCollectionDoc } from '../../collection.js';

/** What this checkout's conductor record supplies to the cockpit's defaults. */
export interface OwnConductor {
  /** This checkout's conductor UUID — preselected in the new-ticket form. */
  conductorId: string | undefined;
  /** The project name it serves — the new-ticket form's default project. */
  project: string | undefined;
}

const NOTHING: OwnConductor = { conductorId: undefined, project: undefined };

/** Id of a single-valued relationship linkage (`data` object), or null. */
function singleRelId(rel: JsonApiRelationship | undefined): string | null {
  const data = rel?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * Pick this checkout's conductor out of a `bb_conductor` collection: this
 * machine's (`machineId`), at this checkout, preferring the default variant.
 * Without a machine UUID nothing is this machine's — an unproven identity is
 * never guessed.
 */
export function selectOwnConductor(
  doc: JsonApiCollectionDoc,
  bakersDir: string,
  machineId: string | undefined,
): OwnConductor {
  if (!machineId) return NOTHING;
  // The current form (BB-450 D3): workspace_root is the checkout root.
  const checkoutRoot = resolve(dirname(bakersDir));
  // The legacy form: a record whose heartbeat has not yet rewritten the
  // field still carries the `.bakers` config directory itself.
  const legacyTarget = resolve(bakersDir);

  const here = (doc.data ?? []).filter((c) => {
    if (singleRelId(c.relationships?.machine) !== machineId) return false;
    const root = str(c.attributes?.workspace_root);
    // A conductor that never reported a workspace matches no directory,
    // whatever `resolve('')` would make of an empty path.
    if (root === undefined) return false;
    const resolved = resolve(root);
    return resolved === checkoutRoot || resolved === legacyTarget;
  });
  const own =
    here.find(
      (c) => (str(c.attributes?.variant) ?? 'conductor') === 'conductor',
    ) ?? here[0];
  if (own === undefined) return NOTHING;

  const projectId = singleRelId(own.relationships?.project_id);
  const project = projectId
    ? str(
        (doc.included ?? []).find((inc) => inc.id === projectId)?.attributes
          ?.name,
      )
    : undefined;
  return { conductorId: own.id, project };
}

/**
 * Read this machine's conductors and resolve this checkout's own record.
 *
 * One request, filtered by `machine.id`, with the project sideloaded, so the
 * project NAME costs no second round trip.
 *
 * A failure yields nothing rather than rejecting: this runs on the boot path,
 * and an unreachable control plane must leave the cockpit openable — the two
 * values it produces are form defaults, not preconditions.
 */
export async function readOwnConductor(
  client: DropshClient,
  bakersDir: string,
  machineId: string | undefined,
): Promise<OwnConductor> {
  if (!machineId) return NOTHING;
  const params = new DrupalJsonApiParams()
    .addInclude(['project_id'])
    .addFilter('machine.id', machineId);
  try {
    const doc = (await client.get(
      'bb_conductor/bb_conductor',
      params,
    )) as JsonApiCollectionDoc;
    return selectOwnConductor(doc, bakersDir, machineId);
  } catch {
    return NOTHING;
  }
}
