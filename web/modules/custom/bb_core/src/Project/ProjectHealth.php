<?php

declare(strict_types=1);

namespace Drupal\bb_core\Project;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Conductor\ConductorOwnerAccess;
use Drupal\bb_core\Derive\TicketRunDeriver;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Names the open tickets of a project where a person has to act now.
 *
 * Each ticket carries at most one reason, the first that matches in the order
 * of reason(). Everything is read per call, never cached: it depends
 * on runs, labels, memberships and the clock. The queries do not grow with the
 * ticket count.
 */
final class ProjectHealth {

  /**
   * Seconds without movement after which a working ticket is idle: 3 days.
   */
  public const IDLE_AFTER = 259200;

  private const DAY = 86400;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly TicketRunDeriver $runs,
    private readonly ConductorOwnerAccess $ownerAccess,
  ) {
  }

  /**
   * The attention set: red before yellow, priority, oldest movement, id.
   *
   * @return list<\Drupal\bb_core\Project\AttentionItem>
   *   One item per unhealthy ticket the current user may view.
   */
  public function attention(BbProjectInterface $project): array {
    $tickets = $this->openTickets($project);
    if ($tickets === []) {
      return [];
    }
    $ids = array_keys($tickets);
    $facts = [
      'live' => array_flip($this->runs->liveRunTicketIds($ids)),
      'newest' => $this->runs->latestRunStates($ids),
      'movement' => $this->movement($ids),
      'labels' => $this->labelNames($tickets),
      'access' => [],
    ];
    $now = $this->time->getRequestTime();
    $rows = [];
    foreach ($tickets as $id => $ticket) {
      $movement = $facts['movement'][$id] ?? (int) $ticket->get('created')->value;
      $reason = $this->reason($ticket, $project, $facts, $now - $movement);
      if ($reason === NULL) {
        continue;
      }
      $priority = (int) $ticket->get('priority')->value;
      $rows[] = [
        new AttentionItem($ticket, $reason[0], $reason[1], $reason[2]),
        $reason[0] === 'red' ? 0 : 1,
        $priority > 0 ? $priority : PHP_INT_MAX,
        $movement,
        (string) $ticket->get('identifier')->value,
      ];
    }
    usort($rows, static fn (array $a, array $b): int => array_slice($a, 1) <=> array_slice($b, 1));
    return array_column($rows, 0);
  }

  /**
   * The ids of the attention set's tickets.
   *
   * @return list<int>
   *   Ticket ids, in attention order.
   */
  public function unhealthyIds(BbProjectInterface $project): array {
    return array_map(static fn (AttentionItem $item): int => (int) $item->ticket->id(), $this->attention($project));
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

  /**
   * The project's open tickets the current user may view, by id.
   *
   * Tickets with an open blocker wait on something else and are left out.
   *
   * @return array<int, \Drupal\bb_core\Entity\BbTicketInterface>
   *   Tickets keyed by id.
   */
  private function openTickets(BbProjectInterface $project): array {
    $storage = $this->entityTypeManager->getStorage('bb_ticket');
    $ids = $storage->getQuery()
      ->accessCheck(TRUE)
      ->condition('project_id', $project->id())
      ->condition('closed', 0)
      ->execute();
    $tickets = array_filter(
      $storage->loadMultiple($ids),
      static fn ($ticket): bool => $ticket instanceof BbTicketInterface,
    );
    // Warm the entity cache, so each blocker check is a cache hit.
    $storage->loadMultiple(array_merge(...array_map(
      static fn (BbTicketInterface $ticket): array => $ticket->getBlockedByIds(),
      $tickets,
    )));
    return array_filter($tickets, static fn (BbTicketInterface $ticket): bool => !$ticket->hasOpenBlockers());
  }

  /**
   * The newest movement per ticket: its newest activity or run change.
   *
   * @param list<int> $ids
   *   Ticket ids.
   *
   * @return array<int, int>
   *   Timestamp per ticket that has any; the rest fall back to creation.
   */
  private function movement(array $ids): array {
    $movement = [];
    // bb_core does not depend on bb_activity: without it, runs alone move.
    $sources = array_filter(['bb_activity' => 'created', 'bb_run' => 'changed'], $this->entityTypeManager->hasDefinition(...), ARRAY_FILTER_USE_KEY);
    foreach ($sources as $type => $field) {
      /** @var array<int, array<string, int|string>> $rows */
      $rows = $this->entityTypeManager->getStorage($type)->getAggregateQuery()
        ->accessCheck(FALSE)
        ->condition('ticket_id', $ids, 'IN')
        ->groupBy('ticket_id')
        ->aggregate($field, 'MAX')
        ->execute();
      foreach ($rows as $row) {
        $ticket_id = (int) $row['ticket_id'];
        $movement[$ticket_id] = max($movement[$ticket_id] ?? 0, (int) $row[$field . '_max']);
      }
    }
    return $movement;
  }

  /**
   * The lower-case label names of each ticket.
   *
   * @param array<int, \Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   Tickets keyed by id.
   *
   * @return array<int, list<string>>
   *   Names per ticket id.
   */
  private function labelNames(array $tickets): array {
    $by_ticket = [];
    foreach ($tickets as $id => $ticket) {
      $by_ticket[$id] = array_column($ticket->get('labels')->getValue(), 'target_id');
    }
    $terms = $this->entityTypeManager->getStorage('bb_term')->loadMultiple(array_unique(array_merge(...$by_ticket)));
    return array_map(
      static fn (array $term_ids): array => array_map(
        static fn ($term_id): string => isset($terms[$term_id]) ? mb_strtolower(trim((string) $terms[$term_id]->label())) : '',
        $term_ids,
      ),
      $by_ticket,
    );
  }

  /**
   * The first matching reason of a ticket, or NULL when none matches.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_core\Entity\BbProjectInterface $project
   *   The project it is read for.
   * @param array{live: array<int, mixed>, newest: array<int, string>, movement: array<int, int>, labels: array<int, list<string>>, access: array<int, bool>} $facts
   *   The batched facts, by ticket id; `access` fills as conductors are asked.
   * @param int $idle
   *   Seconds since the ticket last moved.
   *
   * @return array{0: string, 1: string, 2: int|null}|null
   *   Severity, reason text, idle days.
   */
  private function reason(BbTicketInterface $ticket, BbProjectInterface $project, array &$facts, int $idle): ?array {
    $id = (int) $ticket->id();
    if (in_array('technical problem', $facts['labels'][$id], TRUE)) {
      return ['red', (string) new TranslatableMarkup('Technical problem'), NULL];
    }
    if ($this->conductorLacksAccess($ticket, $project, $facts['access'])) {
      return ['red', (string) new TranslatableMarkup('Conductor has no access'), NULL];
    }
    if (!isset($facts['live'][$id])) {
      $newest = $facts['newest'][$id] ?? '';
      if ($newest === 'failed') {
        return ['red', (string) new TranslatableMarkup('Last run failed'), NULL];
      }
      if ($newest === 'expired') {
        return ['red', (string) new TranslatableMarkup('Last run expired'), NULL];
      }
    }
    if (in_array('question', $facts['labels'][$id], TRUE)) {
      return ['yellow', (string) new TranslatableMarkup('Needs info'), NULL];
    }
    if ((string) $ticket->get('work_state')->value === 'working' && $idle > self::IDLE_AFTER) {
      $days = intdiv($idle, self::DAY);
      return ['yellow', (string) new TranslatableMarkup('Idle @count days', ['@count' => $days]), $days];
    }
    return NULL;
  }

  /**
   * Whether the assigned conductor's owner may no longer work in the project.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_core\Entity\BbProjectInterface $project
   *   The project it is read for.
   * @param array<int, bool> $known
   *   Answers per conductor id, filled as conductors are asked.
   */
  private function conductorLacksAccess(BbTicketInterface $ticket, BbProjectInterface $project, array &$known): bool {
    $conductor = $ticket->get('conductor_id')->entity;
    if (!$conductor instanceof BbConductorInterface) {
      return FALSE;
    }
    $key = (int) $conductor->id();
    $known[$key] ??= $this->ownerAccess->ownerHasAccess($conductor, (int) $project->id());
    return !$known[$key];
  }

}
