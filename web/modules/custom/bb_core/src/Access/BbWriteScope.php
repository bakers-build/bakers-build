<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbRunInterface;

/**
 * Resolves the write scope of an agent or human-assist session.
 */
final class BbWriteScope {

  private const ACTIVE_RUN_STATES = ['claimed', 'running'];

  /**
   * Constructs a BbWriteScope.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {
  }

  /**
   * Returns all ticket IDs the account may write via an active run.
   *
   * Includes the directly claimed ticket and all its descendants (breadth-first
   * traversal of the parent_id hierarchy), as long as at least one active run
   * exists for the session (state in {claimed, running}).
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account whose active runs determine the scope.
   *
   * @return int[]
   *   Flat list of ticket IDs the account is allowed to update.
   */
  public function allowedTicketIds(AccountInterface $account): array {
    $run_storage = $this->entityTypeManager->getStorage('bb_run');
    $run_ids = $run_storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductor_id.entity.owner_user_id', $account->id())
      ->condition('state', self::ACTIVE_RUN_STATES, 'IN')
      ->execute();
    if ($run_ids === []) {
      return [];
    }

    $allowed = [];
    foreach ($run_storage->loadMultiple($run_ids) as $run) {
      if ($run instanceof BbRunInterface && $run->getTicketId() !== NULL) {
        $allowed[$run->getTicketId()] = TRUE;
      }
    }

    $ticket_storage = $this->entityTypeManager->getStorage('bb_ticket');
    $frontier = array_keys($allowed);
    while ($frontier !== []) {
      $children = $ticket_storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('parent_id', $frontier, 'IN')
        ->execute();
      $frontier = [];
      foreach ($children as $child_id) {
        $child_id = (int) $child_id;
        if (!isset($allowed[$child_id])) {
          $allowed[$child_id] = TRUE;
          $frontier[] = $child_id;
        }
      }
    }

    return array_map('intval', array_keys($allowed));
  }

  /**
   * Checks whether a specific ticket ID falls within the account's write scope.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   * @param int $ticket_id
   *   The ticket ID to look up.
   *
   * @return bool
   *   TRUE if the ticket is in the account's active write scope.
   */
  public function isTicketInScope(AccountInterface $account, int $ticket_id): bool {
    return in_array($ticket_id, $this->allowedTicketIds($account), TRUE);
  }

}
