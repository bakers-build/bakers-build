<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Conductor\ConductorOwnerAccess;
use Drupal\bb_core\Derive\TicketRunDeriver;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;

/**
 * Computes and persists ticket health independently of the reader.
 */
final class TicketHealth {

  public const IDLE_DAYS = ['qualification' => 2, 'plan' => 2, 'working' => 3, 'review' => 5];

  public const STALL_AFTER = 21600;

  /**
   * Health-only saves must never create movement or recursively refresh.
   */
  public bool $refreshing = FALSE;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly TicketRunDeriver $runs,
    private readonly ConductorOwnerAccess $ownerAccess,
  ) {}

  /**
   * Evaluates a batch, keyed by ticket id (zero for a new ticket).
   *
   * @param array<\Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   The tickets.
   *
   * @return array<int, array{health: ?string, reason: ?string, moved: int}>
   *   Stored health values.
   */
  public function evaluate(array $tickets): array {
    $ids = array_values(array_filter(array_map(static fn (BbTicketInterface $ticket): int => (int) $ticket->id(), $tickets)));
    $this->warmReferences($tickets);
    $facts = $this->facts($ids);
    $access = [];
    $results = [];
    foreach ($tickets as $ticket) {
      $id = (int) $ticket->id();
      $moved = max((int) $ticket->get('created')->value, (int) $ticket->get('health_moved')->value, $facts['movement'][$id] ?? 0);
      $result = ['health' => 'healthy', 'reason' => NULL, 'moved' => $moved];
      if ($ticket->get('closed')->value) {
        $result['health'] = NULL;
      }
      elseif (!isset($facts['parents'][$id]) && !$ticket->hasOpenBlockers()) {
        $keys = array_map(static fn ($term): string => (string) $term->get('key')->value, $ticket->get('labels')->referencedEntities());
        $critical = $this->criticalReason($ticket, $keys, $facts, $access);
        $result = $critical === NULL
          ? $this->warning($ticket, $keys, $facts['stalled'][$id] ?? NULL, $moved)
          : ['health' => 'critical', 'reason' => $critical, 'moved' => $moved];
      }
      $results[$id] = $result;
    }
    return $results;
  }

  /**
   * Loads referenced facts once per type, rather than once per ticket.
   *
   * @param array<\Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   The batch.
   */
  private function warmReferences(array $tickets): void {
    foreach ([
      'labels' => 'bb_term',
      'blocked_by' => 'bb_ticket',
      'conductor_id' => 'bb_conductor',
      'project_id' => 'bb_project',
    ] as $field => $type) {
      $ids = [];
      foreach ($tickets as $ticket) {
        $ids = array_merge($ids, array_column($ticket->get($field)->getValue(), 'target_id'));
      }
      $this->entityTypeManager->getStorage($type)->loadMultiple(array_unique($ids));
    }
  }

  /**
   * Batched facts; historical runs are aggregated without loading their logs.
   *
   * @param list<int> $ids
   *   Ticket ids.
   *
   * @return array{parents: array<int, int>, movement: array<int, int>, latest: array<int, string>, live: array<int, int>, stalled: array<int, int>}
   *   Facts keyed by ticket id.
   */
  private function facts(array $ids): array {
    $facts = ['parents' => [], 'movement' => [], 'latest' => [], 'live' => [], 'stalled' => []];
    if ($ids === []) {
      return $facts;
    }
    $tickets = $this->entityTypeManager->getStorage('bb_ticket');
    $facts['parents'] = array_flip(array_map('intval', array_column($tickets->getAggregateQuery()->accessCheck(FALSE)
      ->condition('parent_id', $ids, 'IN')->groupBy('parent_id')->execute(), 'parent_id')));
    $facts['latest'] = $this->runs->latestRunStates($ids);
    $live_ids = $this->runs->liveRunTicketIds($ids);
    $facts['live'] = array_flip($live_ids);
    $sources = ['bb_run' => 'state_changed'];
    if ($this->entityTypeManager->hasDefinition('bb_activity')) {
      $sources['bb_activity'] = 'created';
    }
    foreach ($sources as $type => $field) {
      /** @var array<int, array<string, int|string|null>> $rows */
      $rows = $this->entityTypeManager->getStorage($type)->getAggregateQuery()->accessCheck(FALSE)
        ->condition('ticket_id', $ids, 'IN')->groupBy('ticket_id')->aggregate($field, 'MAX')->execute();
      foreach ($rows as $row) {
        $id = (int) $row['ticket_id'];
        $facts['movement'][$id] = max($facts['movement'][$id] ?? 0, (int) $row[$field . '_max']);
      }
    }
    if ($live_ids !== []) {
      $this->liveFacts($live_ids, $facts);
    }
    return $facts;
  }

  /**
   * Reads only live runs, distinguishing a real stall from fresh progress.
   *
   * @param list<int> $ids
   *   Tickets with live runs.
   * @param array{parents: array<int, int>, movement: array<int, int>, latest: array<int, string>, live: array<int, int>, stalled: array<int, int>} $facts
   *   Batch facts to complete.
   */
  private function liveFacts(array $ids, array &$facts): void {
    $storage = $this->entityTypeManager->getStorage('bb_run');
    $now = $this->time->getRequestTime();
    $query = $storage->getQuery()->accessCheck(FALSE)->condition('ticket_id', $ids, 'IN');
    $query->condition($query->orConditionGroup()->condition('state', 'running')
      ->condition($query->andConditionGroup()->condition('state', 'claimed')
        ->condition($query->orConditionGroup()->condition('claim_expires_at', 0)->condition('claim_expires_at', $now, '>='))));
    foreach ($storage->loadMultiple($query->execute()) as $run) {
      if (!$run instanceof BbRunInterface) {
        continue;
      }
      $id = (int) $run->get('ticket_id')->target_id;
      $changed = (int) $run->get('changed')->value;
      if ($now - $changed > self::STALL_AFTER) {
        $facts['stalled'][$id] = min($facts['stalled'][$id] ?? $changed, $changed);
        continue;
      }
      $facts['movement'][$id] = $now;
    }
  }

  /**
   * Critical rules in their specified order.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param array<string> $keys
   *   Its label identities.
   * @param array{parents: array<int, int>, movement: array<int, int>, latest: array<int, string>, live: array<int, int>, stalled: array<int, int>} $facts
   *   Batch facts.
   * @param array<string, bool> $access
   *   Owner access per conductor and project, reused within the batch.
   */
  private function criticalReason(BbTicketInterface $ticket, array $keys, array $facts, array &$access): ?string {
    if (in_array('technical_problem', $keys, TRUE)) {
      return 'technical_problem';
    }
    $conductor = $ticket->get('conductor_id')->entity;
    if ($conductor instanceof BbConductorInterface) {
      $project = $ticket->get('project_id')->entity;
      $key = $conductor->id() . ':' . $project?->id();
      $access[$key] ??= $project instanceof BbProjectInterface && $this->ownerAccess->ownerHasAccess($conductor, (int) $project->id());
      if (!$access[$key]) {
        return 'no_access';
      }
      if ($conductor->get('status')->value === 'offline') {
        return 'conductor_offline';
      }
    }
    $id = (int) $ticket->id();
    $latest = $facts['latest'][$id] ?? '';
    return !isset($facts['live'][$id]) && in_array($latest, ['failed', 'expired'], TRUE) ? 'run_' . $latest : NULL;
  }

  /**
   * Warning rules, including the timestamp used in their displayed reason.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param array<string> $keys
   *   Its label identities.
   * @param int|null $stalled
   *   Oldest stalled live run's last change.
   * @param int $moved
   *   Last real movement.
   *
   * @return array{health: string, reason: ?string, moved: int}
   *   The result.
   */
  private function warning(BbTicketInterface $ticket, array $keys, ?int $stalled, int $moved): array {
    if (in_array('question', $keys, TRUE)) {
      return ['health' => 'warning', 'reason' => 'needs_info', 'moved' => $moved];
    }
    if ($stalled !== NULL) {
      return ['health' => 'warning', 'reason' => 'run_stalled', 'moved' => $stalled];
    }
    $unassigned = $ticket->get('conductor_id')->isEmpty() && $ticket->get('assignee_user_id')->isEmpty();
    $state = (string) $ticket->get('state')->value;
    $days = $unassigned ? 3 : (self::IDLE_DAYS[$state] ?? 3);
    $idle = $this->time->getRequestTime() - $moved > $days * 86400;
    return [
      'health' => $idle ? 'warning' : 'healthy',
      'reason' => $idle ? ($unassigned ? 'not_picked_up' : 'idle_' . $state) : NULL,
      'moved' => $moved,
    ];
  }

  /**
   * Refreshes stored values only when a meaningful value differs.
   *
   * @param array<\Drupal\bb_core\Entity\BbTicketInterface> $tickets
   *   The tickets.
   */
  public function refresh(array $tickets): void {
    if ($this->refreshing || $tickets === []) {
      return;
    }
    $this->refreshing = TRUE;
    try {
      $results = $this->evaluate($tickets);
      foreach ($tickets as $ticket) {
        if ($this->apply($ticket, $results[(int) $ticket->id()])) {
          $ticket->save();
        }
      }
    }
    finally {
      $this->refreshing = FALSE;
    }
  }

  /**
   * Applies a result in place, including during ticket presave.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param array{health: ?string, reason: ?string, moved: int} $result
   *   Evaluated values.
   *
   * @return bool
   *   Whether the persisted health changed.
   */
  public function apply(BbTicketInterface $ticket, array $result): bool {
    $changed = $ticket->get('health')->value !== $result['health']
      || $ticket->get('health_reason')->value !== $result['reason']
      || ($result['health'] !== 'healthy' && (int) $ticket->get('health_moved')->value !== $result['moved']);
    if ($changed || $ticket->get('health_moved')->isEmpty()) {
      $ticket->set('health', $result['health'])->set('health_reason', $result['reason'])
        ->set('health_moved', $result['moved'])->set('health_checked', $this->time->getRequestTime());
      return TRUE;
    }
    return FALSE;
  }

  /**
   * Renders the reason at the current display time.
   */
  public function reasonText(string $code, int $moved, int $now): TranslatableMarkup {
    $age = max(0, $now - $moved);
    $args = ['@count' => intdiv($age, 86400)];
    return match ($code) {
      'technical_problem' => new TranslatableMarkup('Technical problem'),
      'no_access' => new TranslatableMarkup('Conductor has no access'),
      'conductor_offline' => new TranslatableMarkup('Conductor offline'),
      'run_failed' => new TranslatableMarkup('Last run failed'),
      'run_expired' => new TranslatableMarkup('Last run expired'),
      'needs_info' => new TranslatableMarkup('Needs info'),
      'run_stalled' => new TranslatableMarkup('Run unchanged for @count h', ['@count' => intdiv($age, 3600)]),
      'not_picked_up' => new TranslatableMarkup('Not picked up for @count days', $args),
      default => new TranslatableMarkup('In @state for @count days', $args + ['@state' => substr($code, 5)]),
    };
  }

}
