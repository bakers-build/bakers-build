import { Drush } from '@key-tec/playwright-core';

/**
 * Counts and membership identities for the four entities sign-up can create.
 *
 * MOVED OUT OF `login.steps.ts` BY BB-430 (test plan 10.2), because two
 * suites now need one implementation. It was written to prove that signing in
 * provisions **nothing**, and it inverts unchanged to prove that signing **up**
 * provisions exactly one of each: the same snapshot, compared in the other
 * direction.
 *
 * IT RECORDS IDENTITIES AND NOT ONLY COUNTS. A membership deleted and another
 * created in one request leaves the count identical, so the uuid/owner/group
 * tuple is what makes "nothing changed" a fact rather than an arithmetic
 * coincidence.
 */
export interface ProvisionState {
    user: number;
    bb_workspace: number;
    bb_team: number;
    og_membership: number;
    memberships?: unknown[];
}

/**
 * Snapshot the provisioning state of the site under test.
 *
 * SCOPED TO ONE ADDRESS WHEN GIVEN. Four parallel workers provision and remove entities of
 * these same types the whole time, so a site-wide count is noise a concurrent worker moves
 * between "before" and "after" — that is what review found at `ec4ca11d8`
 * (`user: 42` observed `43`, `bb_team` delta `0` observed `1`). Narrowed to the account
 * `address` names — itself by `mail`, workspace/team by `owner_user_id`, membership by
 * `getOwnerId()` — the snapshot reads only what this scenario's own action could have
 * touched, whether or not that account exists yet: a non-existent account scopes to all
 * zeros, which still catches a bug that wrongly creates one.
 */
export function provisionState(address?: string): ProvisionState {
    if (!address) {
        const php =
            '$m = \\Drupal::entityTypeManager(); $result = []; foreach (["user", "bb_workspace", "bb_team", "og_membership"] as $type) { $result[$type] = (int) $m->getStorage($type)->getQuery()->accessCheck(FALSE)->count()->execute(); } foreach ($m->getStorage("og_membership")->loadMultiple() as $membership) { $result["memberships"][] = [$membership->uuid(), $membership->getOwnerId(), $membership->getGroupEntityType(), $membership->getGroupId(), $membership->getState()]; } print json_encode($result);';
        return JSON.parse(Drush.exec(`ev '${php}'`).trim()) as ProvisionState;
    }
    const mail = address.replace(/'/g, "\\'");
    const php = [
        `$m = \\Drupal::entityTypeManager();`,
        `$u = current($m->getStorage("user")->loadByProperties(["mail" => "${mail}"]));`,
        `$uid = $u ? (int) $u->id() : -1;`,
        `$result = [];`,
        `$result["user"] = (int) $m->getStorage("user")->getQuery()->accessCheck(FALSE)->condition("mail", "${mail}")->count()->execute();`,
        `foreach (["bb_workspace", "bb_team"] as $type) { $result[$type] = $uid < 0 ? 0 : (int) $m->getStorage($type)->getQuery()->accessCheck(FALSE)->condition("owner_user_id", $uid)->count()->execute(); }`,
        `$memberships = $uid < 0 ? [] : array_filter($m->getStorage("og_membership")->loadMultiple(), fn ($ms) => (int) $ms->getOwnerId() === $uid);`,
        `$result["og_membership"] = count($memberships);`,
        `$result["memberships"] = [];`,
        `foreach ($memberships as $membership) { $result["memberships"][] = [$membership->uuid(), $membership->getOwnerId(), $membership->getGroupEntityType(), $membership->getGroupId(), $membership->getState()]; }`,
        `print json_encode($result);`,
    ].join(' ');
    return JSON.parse(Drush.exec(`ev '${php}'`).trim()) as ProvisionState;
}

/**
 * The per-entity delta between two snapshots, memberships counted rather than
 * listed so a failure message names numbers instead of printing every row.
 */
export function provisionDelta(before: ProvisionState, after: ProvisionState): Record<string, number> {
    return {
        user: after.user - before.user,
        bb_workspace: after.bb_workspace - before.bb_workspace,
        bb_team: after.bb_team - before.bb_team,
        og_membership: after.og_membership - before.og_membership,
    };
}
