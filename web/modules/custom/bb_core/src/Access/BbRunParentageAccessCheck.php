<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultForbidden;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Routing\Access\AccessInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Contradicts a nested run URL that names the wrong ticket.
 *
 * `{bb_ticket}` must be this run's ticket. A mismatch is 404, never 403,
 * so the URL does not confirm that the run exists under another ticket.
 * BbWorkspaceNotFoundSubscriber turns the marked forbidden result into a 404.
 */
final class BbRunParentageAccessCheck implements AccessInterface {

  /**
   * The reason marking a forbidden result as a parentage-path failure.
   */
  public const PARENTAGE_MISMATCH_REASON = 'bb_core.run_parentage_mismatch';

  /**
   * Checks that the path's ticket owns the run.
   *
   * @param \Drupal\Core\Routing\RouteMatchInterface $route_match
   *   The current route match.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   Unused: the URL, not the session, is the claim.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   Allowed, or forbidden with PARENTAGE_MISMATCH_REASON.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function access(RouteMatchInterface $route_match, AccountInterface $account): AccessResultInterface {
    $run = $route_match->getParameter('bb_run');
    $ticket = $route_match->getParameter('bb_ticket');
    if (!$run instanceof BbRunInterface || !$ticket instanceof BbTicketInterface) {
      return $this->notFound();
    }

    $result = AccessResult::allowed()
      ->addCacheableDependency($run)
      ->addCacheableDependency($ticket);
    if ($run->getTicketId() !== (int) $ticket->id()) {
      return $this->notFound()->addCacheableDependency($result);
    }
    return $result;
  }

  /**
   * The marked forbidden verdict the exception subscriber turns into a 404.
   */
  private function notFound(): AccessResultForbidden {
    return AccessResult::forbidden(self::PARENTAGE_MISMATCH_REASON);
  }

}
