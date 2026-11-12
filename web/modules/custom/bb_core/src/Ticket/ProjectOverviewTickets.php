<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Project Overview stocks: epics, their progress and whether tickets exist.
 */
final class ProjectOverviewTickets {

  /**
   * Board work states per progress part.
   */
  private const PARTS = [
    'done' => ['done'],
    'in_progress' => ['working'],
    'open' => ['not_assigned', 'intake'],
  ];

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
   *   Every ticket of type `epic` in the project the account may view.
   */
  public function epicTickets(BbProjectInterface $project): array {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('project_id', $project->id())
      ->condition('ticket_type.entity:bb_term.name', 'epic')
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

  /**
   * Whether the account may view any ticket of the project.
   */
  public function hasTickets(BbProjectInterface $project): bool {
    return (bool) $this->entityTypeManager->getStorage('bb_ticket')->getQuery()
      ->accessCheck(TRUE)
      ->condition('project_id', $project->id())
      ->count()
      ->range(0, 1)
      ->execute();
  }

  /**
   * Direct children of each epic by the Board's work state.
   *
   * Read from the ticket index the Board reads, one faceted query per part,
   * narrowed to the account's scope.
   *
   * @param list<\Drupal\bb_core\Entity\BbTicketInterface> $epics
   *   The epics.
   *
   * @return array<int, array{done: int, in_progress: int, open: int, total: int}>
   *   Counts keyed by epic id, in the order given.
   */
  public function epicProgress(array $epics): array {
    $progress = [];
    foreach ($epics as $epic) {
      $progress[(int) $epic->id()] = ['done' => 0, 'in_progress' => 0, 'open' => 0, 'total' => 0];
    }
    $index = $progress === [] ? NULL : $this->entityTypeManager->getStorage('search_api_index')->load('bb_tickets');
    if ($index === NULL) {
      return $progress;
    }
    foreach (self::PARTS as $part => $states) {
      $query = $index->query();
      $query->addCondition('parent_id', array_keys($progress), 'IN');
      $query->addCondition('work_state', $states, 'IN');
      $query->setOption('search_api_facets', [
        'parent_id' => ['field' => 'parent_id', 'limit' => 0, 'min_count' => 1, 'missing' => FALSE, 'operator' => 'and'],
      ]);
      $query->range(0, 1);
      foreach ($query->execute()->getExtraData('search_api_facets', [])['parent_id'] ?? [] as $row) {
        $id = (int) trim((string) $row['filter'], '"');
        if (isset($progress[$id])) {
          $progress[$id][$part] = (int) $row['count'];
          $progress[$id]['total'] += (int) $row['count'];
        }
      }
    }
    return $progress;
  }

}
