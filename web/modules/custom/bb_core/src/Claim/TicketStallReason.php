<?php

declare(strict_types=1);

namespace Drupal\bb_core\Claim;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Conductor\ConductorOwnerAccess;
use Drupal\bb_core\Derive\TicketRunDeriver;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Time\BbDate;
use Drupal\bb_core\Workflow\TypeWorkflows;

/**
 * Names why a ticket is standing still.
 *
 * Operator-facing labels, in priority order: frozen, blocked, no conductor,
 * conductor no access, failing. A closed or terminal ticket has none. A live
 * run short-circuits to no reason, except freeze which wins even while a run
 * is still finishing.
 * `running` is live regardless of lease; `claimed` only with a live lease.
 */
final class TicketStallReason {

  /**
   * Constructs a TicketStallReason.
   *
   * @param \Drupal\bb_core\Derive\TicketRunDeriver $runs
   *   Answers whether a ticket carries a live run.
   * @param \Drupal\bb_core\Claim\FailedRunCircuitBreaker $circuitBreaker
   *   The failed-run circuit breaker, used for the failing label.
   * @param \Drupal\bb_core\Conductor\ConductorOwnerAccess $ownerAccess
   *   Whether the assigned conductor's owner may still work in the project.
   */
  public function __construct(
    private readonly TicketRunDeriver $runs,
    private readonly FailedRunCircuitBreaker $circuitBreaker,
    private readonly ConductorOwnerAccess $ownerAccess,
  ) {
  }

  /**
   * Badge props for an operator-facing stall label.
   *
   * `wait` is the tone for nobody acting on this. `dot` keeps the colour in
   * words and as a mark. Empty `icon`/`suffix` satisfy the badge cell contract.
   * A frozen reason carries the hold's age in `suffix` when a stamp exists.
   *
   * @return array{label: string, tone: string, dot: bool, icon: string, suffix: string, suffix_datetime?: string, suffix_title?: string}
   *   Props for `bb_theme:badge`; a dated suffix also names its instant.
   */
  public static function badge(string $reason, ?int $frozenAt = NULL): array {
    $badge = [
      'label' => self::label($reason),
      'tone' => 'wait',
      'dot' => TRUE,
      'icon' => '',
      'suffix' => $reason === 'frozen' ? self::since($frozenAt) : '',
    ];
    if ($badge['suffix'] !== '' && $frozenAt !== NULL) {
      $time = \Drupal::service(BbDate::class)->cell($frozenAt);
      $badge['suffix_datetime'] = $time['datetime'];
      $badge['suffix_title'] = $time['title'];
    }
    return $badge;
  }

  /**
   * Cacheability of anything that shows a ticket's stall reason.
   *
   * "blocked" depends on other tickets and runs, so the reason follows both
   * list tags; "conductor no access" follows memberships; a freeze age is
   * relative to now, so a frozen one is uncacheable.
   */
  public static function cacheability(BbTicketInterface $ticket): CacheableMetadata {
    $metadata = CacheableMetadata::createFromObject($ticket)
      ->addCacheTags(['bb_run_list', 'bb_ticket_list', 'og_membership_list']);
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
      'conductor no access' => new TranslatableMarkup('conductor has no access'),
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
    return \Drupal::service(BbDate::class)->label($frozenAt);
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
    if ($this->runs->hasLiveRun($ticket)) {
      return '';
    }
    if ($ticket->hasOpenBlockers()) {
      return 'blocked';
    }
    if ($workflow !== '') {
      $reason = $this->conductorReason($ticket);
      if ($reason !== '') {
        return $reason;
      }
    }
    if ($this->circuitBreaker->isTripped($ticket)) {
      return 'failing';
    }
    return '';
  }

  /**
   * Why a classified ticket's conductor cannot take it, or empty.
   */
  private function conductorReason(BbTicketInterface $ticket): string {
    $conductor = $ticket->get('conductor_id')->entity;
    if (!$conductor instanceof BbConductorInterface) {
      return 'no conductor';
    }
    return $this->ownerAccess->ownerHasAccess($conductor, (int) $ticket->get('project_id')->target_id) ? '' : 'conductor no access';
  }

}
