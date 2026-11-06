// BB-232 (spec Decision D9) — "which conductor is THIS checkout's?", answered
// from the control plane instead of the deleted `~/.bakers/conductors.json`.
//
// The `bakers ui` entry used to read the project this checkout belongs to
// straight out of the registry file; it is the cockpit's default project. The
// entry cannot resolve it itself — it holds no JSON:API client (BB-223 spec Finding 1) —
// so it hands over the `.bakers` dir it is standing in and the renderer matches it
// against each conductor's `workspace_root`, which is the same directory the
// registry's `path` held.
//
// The matching rule is deliberately unchanged from the registry lookup it
// replaces (`resolve(entry.path) === resolve(bakersDir)`): an exact, normalised
// path comparison, never a longest-prefix walk. So a worktree — which has its
// own `.bakers` — resolves to no conductor rather than quietly inheriting its
// parent checkout's project, exactly as before.
//
// BB-450 D3/D15: `workspace_root` now holds the checkout root, not this
// `.bakers` config directory, because every heartbeat rewrites the field going
// forward. A record written before that change still carries the legacy
// `.bakers` value until its next heartbeat, so the match accepts EITHER form —
// the derived checkout root (`dirname(bakersDir)`) or the legacy `bakersDir`
// itself — so a cockpit opened against an un-healed record still resolves.
import { dirname, resolve } from 'node:path';
import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { DropshClient, JsonApiRelationship } from '../../../types.js';
import type { JsonApiCollectionDoc } from '../../collection.js';

/** What this checkout's conductor record supplies to the cockpit's defaults. */
export interface OwnConductor {
  /** The project name it serves — the cockpit's default project. */
  project: string | undefined;
}

const NOTHING: OwnConductor = { project: undefined };

/** Id of a single-valued relationship linkage (`data` object), or null. */
function singleRelId(rel: JsonApiRelationship | undefined): string | null {
  const data = rel?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

/**
 * Pick this checkout's conductor out of a `bb_conductor` collection.
 *
 * A repo may host several conductor configs, and they share one
 * `workspace_root` — the dir alone cannot say which of them the cockpit belongs
 * to. The first in server order is taken, and that is a documented guess rather
 * than a resolution: it only picks the default project, which `--project`
 * overrides.
 */
export function selectOwnConductor(
  doc: JsonApiCollectionDoc,
  bakersDir: string,
): OwnConductor {
  // The current form (BB-450 D3): workspace_root is the checkout root.
  const checkoutRoot = resolve(dirname(bakersDir));
  // The legacy form: a record whose heartbeat has not yet rewritten the
  // field still carries the `.bakers` config directory itself.
  const legacyTarget = resolve(bakersDir);

  const own = (doc.data ?? []).find((c) => {
    const root = str(c.attributes?.workspace_root);
    // A conductor that never reported a workspace matches no directory,
    // whatever `resolve('')` would make of an empty path.
    if (root === undefined) return false;
    const resolved = resolve(root);
    return resolved === checkoutRoot || resolved === legacyTarget;
  });
  if (own === undefined) return NOTHING;

  const projectId = singleRelId(own.relationships?.project_id);
  const project = projectId
    ? str(
        (doc.included ?? []).find((inc) => inc.id === projectId)?.attributes
          ?.name,
      )
    : undefined;

  return { project };
}

/**
 * Read the conductor collection and resolve this checkout's own record.
 *
 * One request with the project sideloaded, so the project NAME costs no second
 * round trip. The read is NOT owner-gated: BB-391 granted `view bb_conductor` to every
 * `bb:session` token, so this reads the whole collection. That is harmless
 * here — the match is on `workspace_root`, a path on THIS machine, which no
 * other user's record can hold. BB-460 filters the conductor LIST by owner;
 * this lookup needs no filter because its predicate is already stricter.
 *
 * A failure yields nothing rather than rejecting: this runs on the boot path,
 * and an unreachable control plane must leave the cockpit openable — the
 * project it produces is a default, not a precondition.
 */
export async function readOwnConductor(
  client: DropshClient,
  bakersDir: string,
): Promise<OwnConductor> {
  const params = new DrupalJsonApiParams().addInclude(['project_id']);
  try {
    const doc = (await client.get(
      'bb_conductor/bb_conductor',
      params,
    )) as JsonApiCollectionDoc;
    return selectOwnConductor(doc, bakersDir);
  } catch {
    return NOTHING;
  }
}
