<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultForbidden;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Routing\Access\AccessInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\user\UserInterface;

/**
 * Contradicts a user-area URL that names the wrong account for a machine.
 *
 * `_bb_machine_owner_match` on product View and Settings: `{user}` must
 * be the machine's owner. A mismatch is 404, never 403, so the URL does
 * not confirm that the machine exists under another account. The verdict
 * is a forbidden result carrying OWNER_MISMATCH_REASON;
 * BbWorkspaceNotFoundSubscriber turns that marker into a 404.
 */
final class BbMachineOwnerAccessCheck implements AccessInterface {

  /**
   * The reason marking a forbidden result as an owner-path failure.
   *
   * Core copies an AccessResultReasonInterface reason into the
   * AccessDeniedHttpException message, which lets the exception subscriber
   * recognise this verdict. Deliberately not user-facing text.
   */
  public const OWNER_MISMATCH_REASON = 'bb_core.machine_owner_mismatch';

  /**
   * Checks that the path's `{user}` is the machine owner.
   *
   * @param \Drupal\Core\Routing\RouteMatchInterface $route_match
   *   The current route match.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check. Unused: the URL, not the session, is the claim.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   Allowed, or forbidden with OWNER_MISMATCH_REASON.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function access(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $machine = $route_match->getParameter('bb_machine');
    if (!$machine instanceof BbMachineInterface) {
      return $this->notFound();
    }

    $user = $route_match->getParameter('user');
    $user_id = $user instanceof UserInterface ? (int) $user->id() : (int) $user;
    $owner_id = (int) $machine->get('owner_user_id')->target_id;
    $result = AccessResult::allowed()
      ->addCacheableDependency($machine);
    if ($user instanceof UserInterface) {
      $result->addCacheableDependency($user);
    }

    if ($owner_id === 0 || $user_id !== $owner_id) {
      return $this->notFound()->addCacheableDependency($result);
    }

    return $result;
  }

  /**
   * The marked forbidden verdict the exception subscriber turns into a 404.
   *
   * @return \Drupal\Core\Access\AccessResultForbidden
   *   Forbidden, reasoned with OWNER_MISMATCH_REASON.
   */
  private function notFound(): AccessResultForbidden {
    return AccessResult::forbidden(self::OWNER_MISMATCH_REASON);
  }

}
