<?php

declare(strict_types=1);

namespace Drupal\bb_core\Run;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\bb_core\Time\BbDate;

/**
 * Sums up the runs of many tickets in one query, for a list page or a ticket.
 *
 * Counts only the runs the reader may view, so the newest run is the top row
 * of the reader's Run history (created, then id, descending).
 */
final class TicketRunSummary {

  /**
   * One ticket's summaries, cached for the request by account and ticket id.
   *
   * @var array<string, \Drupal\bb_core\Run\RunSummary|null>
   */
  private array $memo = [];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbDate $date,
    private readonly AccountProxyInterface $currentUser,
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

  /**
   * One ticket's runs summary for the reader, once per request.
   *
   * "No runs yet" is true only for a reader who may view every run of the
   * ticket. Any other reader who sees no run gets no summary.
   *
   * @return \Drupal\bb_core\Run\RunSummary|null
   *   The summary, or NULL when it would claim runs the reader cannot see
   *   do not exist.
   */
  public function forTicket(int|string $ticket_id): ?RunSummary {
    $key = $this->currentUser->id() . ':' . $ticket_id;
    if (!array_key_exists($key, $this->memo)) {
      $summary = $this->forTickets([$ticket_id])[(int) $ticket_id];
      $this->memo[$key] = $summary->count > 0 || $this->mayViewEveryRun($ticket_id) ? $summary : NULL;
    }
    return $this->memo[$key];
  }

  /**
   * Whether the reader may view any run of the ticket, not only their own.
   *
   * Probes an unsaved run, so the real access handler decides: run view in
   * the ticket's workspace passes, a conductor owner's own-run grant does not.
   */
  private function mayViewEveryRun(int|string $ticket_id): bool {
    return $this->entityTypeManager->getStorage('bb_run')
      ->create(['ticket_id' => $ticket_id])
      ->access('view', $this->currentUser);
  }

}
