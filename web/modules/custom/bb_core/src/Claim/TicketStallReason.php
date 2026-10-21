<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;

/**
 * Names why a ticket is standing still.
 *
 * Operator-facing labels, in priority order: frozen, blocked, no conductor,
 * failing. A closed or terminal ticket has none. A live run short-circuits
 * to no reason, except freeze which wins even while a run is still finishing.
 * `running` is live regardless of lease; `claimed` only with a live lease.
 */
final class TicketStallReason {

  /**
   * Constructs a TicketStallReason.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager, used to query the ticket's live runs.
   * @param \Drupal\Component\Datetime\TimeInterface $time
   *   The time service, used to evaluate claim leases.
   * @param \Drupal\bb_core\Claim\FailedRunCircuitBreaker $circuitBreaker
   *   The failed-run circuit breaker, used for the failing label.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
    private readonly FailedRunCircuitBreaker $circuitBreaker,
  ) {
  }

  /**
   * Badge props for an operator-facing stall label.
   *
   * `wait` is the tone for nobody acting on this. `dot` keeps the colour in
   * words and as a mark. Empty `icon`/`suffix` satisfy the badge cell contract.
   * A frozen reason carries the hold's age in `suffix` when a stamp exists.
   *
   * @return array{label: string, tone: string, dot: bool, icon: string, suffix: string}
   *   Props for `bb_theme:badge`.
   */
  public static function badge(string $reason, ?int $frozenAt = NULL): array {
    return [
      'label' => self::label($reason),
      'tone' => 'wait',
      'dot' => TRUE,
      'icon' => '',
      'suffix' => $reason === 'frozen' ? self::since($frozenAt) : '',
    ];
  }

  /**
   * Cacheability of anything that shows a ticket's stall reason.
   *
   * "blocked" depends on other tickets and runs, so the reason follows both
   * list tags; a freeze age is relative to now, so a frozen one is uncacheable.
   */
  public static function cacheability(BbTicketInterface $ticket): CacheableMetadata {
    $metadata = CacheableMetadata::createFromObject($ticket)
      ->addCacheTags(['bb_run_list', 'bb_ticket_list']);
    if ((string) $ticket->get('stall_reason')->value === 'frozen') {
      $metadata->setCacheMaxAge(0);
    }
    return $metadata;
  }

  /**
   * The translated label for a stall reason.
   */
  public static function label(string $reason): string {
    return (string) match ($reason) {
      'frozen' => new TranslatableMarkup('frozen'),
      'blocked' => new TranslatableMarkup('blocked'),
      'no conductor' => new TranslatableMarkup('no conductor'),
      'failing' => new TranslatableMarkup('failing'),
      default => $reason,
    };
  }

  /**
   * Relative age of a freeze stamp, or empty when there is none.
   */
  public static function since(?int $frozenAt): string {
    if ($frozenAt === NULL || $frozenAt <= 0) {
      return '';
    }
    if (\Drupal::time()->getRequestTime() - $frozenAt < 2) {
      return (string) new TranslatableMarkup('just now');
    }
    /** @var \Drupal\Core\Datetime\DateFormatterInterface $formatter */
    $formatter = \Drupal::service('date.formatter');
    return (string) new TranslatableMarkup('@interval ago', [
      '@interval' => $formatter->formatTimeDiffSince($frozenAt, [
        'granularity' => 1,
      ]),
    ]);
  }

  /**
   * The operator-facing reason this ticket is standing still, or empty.
   */
  public function reasonFor(BbTicketInterface $ticket): string {
    // A finished ticket is not standing still; the gate never offers it.
    $workflow = $ticket->getWorkflow();
    if ($ticket->isClosed() || ($workflow !== '' && TypeWorkflows::isTerminal($workflow, (string) $ticket->get('state')->value))) {
      return '';
    }
    if ($ticket->isFrozen()) {
      return 'frozen';
    }
    if ($this->hasLiveRun($ticket)) {
      return '';
    }
    if ($ticket->hasOpenBlockers()) {
      return 'blocked';
    }
    if ($workflow !== '' && $ticket->get('conductor_id')->isEmpty()) {
      return 'no conductor';
    }
    if ($this->circuitBreaker->isTripped($ticket)) {
      return 'failing';
    }
    return '';
  }

  /**
   * Whether the ticket currently carries a live run.
   *
   * Matches TicketClaimService::countLiveRunsOnMachine: running is always
   * live; claimed is live only with claim_expires_at 0 or still unexpired.
   */
  private function hasLiveRun(BbTicketInterface $ticket): bool {
    $now = $this->time->getRequestTime();
    $query = $this->entityTypeManager->getStorage('bb_run')->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id());
    $live = $query->orConditionGroup()
      ->condition('state', 'running')
      ->condition($query->andConditionGroup()
        ->condition('state', 'claimed')
        ->condition($query->orConditionGroup()
          ->condition('claim_expires_at', 0)
          ->condition('claim_expires_at', $now, '>=')));
    return $query->condition($live)->range(0, 1)->execute() !== [];
  }

}
