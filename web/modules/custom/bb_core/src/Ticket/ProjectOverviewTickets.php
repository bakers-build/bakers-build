<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Project Overview stocks: epics.
 */
final class ProjectOverviewTickets {

  /**
   * Loads tickets.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Epic tickets of one project, identifier order.
   *
   * @return list<\Drupal\bb_core\Entity\BbTicketInterface>
   *   Every `bb_epic` ticket of the project the account may view.
   */
  public function epicTickets(BbProjectInterface $project): array {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('project_id', $project->id())
      ->condition('workflow', 'bb_epic')
      ->sort('identifier')
      ->execute();
    if ($ids === []) {
      return [];
    }
    $tickets = [];
    foreach ($storage->loadMultiple($ids) as $epic) {
      if ($epic instanceof BbTicketInterface && $epic->access('view')) {
        $tickets[] = $epic;
      }
    }
    return $tickets;
  }

}
