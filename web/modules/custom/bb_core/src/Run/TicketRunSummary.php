<?php

declare(strict_types=1);

namespace Drupal\bb_core\Run;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Time\BbDate;

/**
 * Sums up the runs of many tickets in one query, for a list page or a ticket.
 *
 * Counts only the runs the reader may view, so the newest run is the top row
 * of the reader's Run history (created, then id, descending).
 */
final class TicketRunSummary {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbDate $date,
  ) {}

  /**
   * The runs summary of each ticket.
   *
   * @param array<int|string> $ticket_ids
   *   The ticket ids.
   *
   * @return array<int, \Drupal\bb_core\Run\RunSummary>
   *   The summary per ticket id, in the given order; no runs count 0.
   */
  public function forTickets(array $ticket_ids): array {
    $ticket_ids = array_map('intval', $ticket_ids);
    if ($ticket_ids === []) {
      return [];
    }
    // One group per ticket, second and state, newest first: a ticket's first
    // group holds its newest run, and the groups' counts add up to its runs.
    /** @var array<int, array<string, int|string>> $groups */
    $groups = $this->entityTypeManager->getStorage('bb_run')->getAggregateQuery()
      ->accessCheck(TRUE)
      ->condition('ticket_id', $ticket_ids, 'IN')
      ->groupBy('ticket_id')
      ->groupBy('created')
      ->groupBy('state')
      ->aggregate('id', 'COUNT')
      ->sort('created', 'DESC')
      ->sortAggregate('id', 'MAX', 'DESC')
      ->execute();
    $counts = array_fill_keys($ticket_ids, 0);
    $newest = [];
    foreach ($groups as $group) {
      $id = (int) $group['ticket_id'];
      $counts[$id] += (int) $group['id_count'];
      $newest[$id] ??= $group;
    }
    $summaries = [];
    foreach ($counts as $id => $count) {
      if (!isset($newest[$id])) {
        $summaries[$id] = new RunSummary(0);
        continue;
      }
      $at = (int) $newest[$id]['created'];
      $summaries[$id] = new RunSummary($count, (string) $newest[$id]['state'], $at, $this->date->time($at));
    }
    return $summaries;
  }

}
