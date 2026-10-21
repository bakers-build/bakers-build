<?php

declare(strict_types=1);

namespace Drupal\bb_track\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Linking a ticket's billing account is a project editor's action.
 */
final class TicketAccountAccess {

  /**
   * Ticket view and update access on the ticket's project, while it is open.
   *
   * A closed ticket is read-only, its billing link included.
   */
  public static function link(EntityInterface $bb_ticket, AccountInterface $account): AccessResultInterface {
    if (!$bb_ticket instanceof BbTicketInterface) {
      return AccessResult::forbidden();
    }
    $project = $bb_ticket->get('project_id')->entity;
    if (!$project instanceof EntityInterface) {
      return AccessResult::forbidden()->addCacheableDependency($bb_ticket);
    }
    return AccessResult::allowedIf(!$bb_ticket->isClosed())->addCacheableDependency($bb_ticket)
      ->andIf($bb_ticket->access('view', $account, TRUE))
      ->andIf($project->access('update', $account, TRUE));
  }

}
