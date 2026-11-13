<?php

declare(strict_types=1);

namespace Drupal\bb_core\Project;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Ticket\TicketHealth;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Names the open tickets of a project where a person has to act now.
 *
 * Reads stored health with the viewer's access scope.
 */
final class ProjectHealth {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly TicketHealth $health,
  ) {
  }

  /**
   * The attention set: red before yellow, priority, oldest movement, id.
   *
   * @return list<\Drupal\bb_core\Project\AttentionItem>
   *   One item per unhealthy ticket the current user may view.
   */
  public function attention(BbProjectInterface $project): array {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()->accessCheck(TRUE)
      ->condition('project_id', $project->id())->condition('closed', 0)
      ->condition('health', TicketHealth::UNHEALTHY, 'IN')->execute();
    $rows = [];
    foreach ($storage->loadMultiple($ids) as $ticket) {
      if (!$ticket instanceof BbTicketInterface) {
        continue;
      }
      $moved = (int) $ticket->get('health_moved')->value;
      $code = (string) $ticket->get('health_reason')->value;
      $priority = (int) $ticket->get('priority')->value;
      $rows[] = [
        new AttentionItem($ticket, (string) $ticket->get('health')->value,
          (string) $this->health->reasonText($code, $moved, $this->time->getRequestTime()),
          str_starts_with($code, 'idle_') || $code === 'not_picked_up' ? intdiv(max(0, $this->time->getRequestTime() - $moved), 86400) : NULL),
        $ticket->get('health')->value === 'critical' ? 0 : 1,
        $priority > 0 ? $priority : PHP_INT_MAX,
        $moved,
        (string) $ticket->get('identifier')->value,
      ];
    }
    // Empty priorities sort last, consistently across database drivers.
    usort($rows, static fn (array $a, array $b): int => array_slice($a, 1) <=> array_slice($b, 1));
    return array_column($rows, 0);
  }

  /**
   * The intake and working counts the Board columns show, unfiltered.
   *
   * Read from the ticket index, which narrows to the current user's scope.
   *
   * @return array{intake: int, working: int}
   *   Tickets per work state.
   */
  public function workStateCounts(BbProjectInterface $project): array {
    $counts = ['intake' => 0, 'working' => 0];
    $index = $this->entityTypeManager->getStorage('search_api_index')->load('bb_tickets');
    if ($index === NULL) {
      return $counts;
    }
    $query = $index->query();
    $query->addCondition('project_id', $project->id());
    $facet = [
      'field' => 'work_state',
      'limit' => 0,
      'min_count' => 1,
      'missing' => FALSE,
      'operator' => 'and',
    ];
    $query->setOption('search_api_facets', ['work_state' => $facet]);
    $query->range(0, 1);
    $rows = $query->execute()->getExtraData('search_api_facets', [])['work_state'] ?? [];
    foreach ($rows as $row) {
      $state = trim((string) $row['filter'], '"');
      if (isset($counts[$state])) {
        $counts[$state] = (int) $row['count'];
      }
    }
    return $counts;
  }

}
