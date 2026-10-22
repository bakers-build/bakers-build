<?php

declare(strict_types=1);

namespace Drupal\bb_core\Deploy;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\og\OgMembershipInterface;

/**
 * Selects the accounts the OAuth bootstrap seeds a consumer for.
 *
 * A team member is anyone in a workspace: capability lives in OG ranks, not
 * site-wide roles. Kept out of `scripts/deploy/ensure-oauth.php` so the
 * selection is testable — under-matching there only shortens the success log.
 *
 * @see \Drupal\bb_core\Deploy\OauthConsumerSecret
 */
final class OauthConsumerCandidates {

  /**
   * The group entity type whose membership makes an account a team member.
   */
  public const GROUP_ENTITY_TYPE = 'bb_workspace';

  /**
   * The uids of accounts holding an active membership on any workspace.
   *
   * Uid 1 is excluded by construction. The old role-based selector could not
   * reach the superuser unless someone had explicitly granted it `bb_agent`;
   * workspace membership is a far wider net (uid 1 is a plausible member of the
   * default workspace), and a client_credentials consumer bound to the
   * superuser would be a root-privileged token minted by a deploy script — a
   * strictly worse posture than the one this replaces.
   *
   * Ranks are deliberately NOT filtered: team users hold different ranks, and
   * a selector keyed on a rank would seed one group and silently skip the
   * other.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   *
   * @return list<int>
   *   Unique uids, ascending. Empty when no workspace has members.
   */
  public static function uids(EntityTypeManagerInterface $entityTypeManager): array {
    $storage = $entityTypeManager->getStorage('og_membership');
    $ids = $storage->getQuery()
      ->condition('entity_type', self::GROUP_ENTITY_TYPE)
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->accessCheck(FALSE)
      ->execute();
    if (!$ids) {
      return [];
    }

    $uids = [];
    foreach ($storage->loadMultiple($ids) as $membership) {
      if (!$membership instanceof OgMembershipInterface) {
        continue;
      }
      $uid = (int) $membership->getOwnerId();
      // Uid 0 is anonymous and cannot own a consumer; uid 1 is the superuser.
      if ($uid > 1) {
        $uids[$uid] = $uid;
      }
    }
    ksort($uids);

    return array_values($uids);
  }

}
