<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Entity;

use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_core\Entity\BbContentEntityInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTargetInterface;
use Drupal\bb_ticket_trigger\TicketTrigger\BbTicketTriggerTypeInterface;
use Drupal\user\UserInterface;

/**
 * A trigger that acts on its target when its type fires.
 *
 * Configuration (target, type plugin and its settings, enabled, actor) is
 * edited by the target's managers. Runtime state (`next_run` …
 * `last_ticket_id`) is written only through recordOutcome() by
 * \Drupal\bb_ticket_trigger\TicketTrigger\TicketTriggerRunner.
 */
interface BbTicketTriggerInterface extends BbContentEntityInterface {

  /**
   * The outcome values of `last_status`.
   */
  public const STATUS_SUCCESS = 'success';
  public const STATUS_FAILED = 'failed';
  public const STATUS_RETRYING = 'retrying';
  public const STATUS_SKIPPED = 'skipped';
  public const STATUS_UNAVAILABLE = 'unavailable';

  /**
   * The target the trigger acts on, or NULL when it no longer exists.
   */
  public function getTarget(): ?EntityInterface;

  /**
   * The target plugin of the trigger's bundle.
   */
  public function getTargetPlugin(): BbTicketTriggerTargetInterface;

  /**
   * The workspace the trigger is anchored in, or NULL.
   */
  public function getWorkspace(): ?BbWorkspaceInterface;

  /**
   * The stored type plugin ID, read without instantiating the plugin.
   */
  public function getType(): string;

  /**
   * The type plugin, or an UnavailableTriggerType stand-in.
   */
  public function getTypePlugin(): BbTicketTriggerTypeInterface;

  /**
   * Whether the trigger is active (not paused).
   */
  public function isEnabled(): bool;

  /**
   * The execution identity, or NULL when none is set.
   */
  public function getActor(): ?UserInterface;

  /**
   * The next due occurrence (UTC timestamp), or NULL.
   */
  public function getNextRun(): ?int;

  /**
   * The last finished occurrence, the replay key; NULL when none.
   */
  public function getLastOccurrence(): ?int;

  /**
   * Failed attempts for the occurrence in `next_run`.
   */
  public function getAttempts(): int;

  /**
   * The latest outcome, one of the STATUS_* values, or '' before any run.
   */
  public function getLastStatus(): string;

  /**
   * Records one runner outcome and saves the trigger.
   *
   * The only writer of the runtime fields.
   *
   * @param string $status
   *   One of the STATUS_* values.
   * @param string $message
   *   The error or note of this outcome.
   * @param int|null $occurrence
   *   The finished occurrence to store as the replay key, or NULL to keep the
   *   stored one.
   * @param \Drupal\bb_core\Entity\BbTicketInterface|null $ticket
   *   The ticket a success created, or NULL to keep the stored one.
   * @param int|null $nextRun
   *   The next due occurrence.
   * @param int $attempts
   *   Failed attempts for the occurrence in $nextRun.
   */
  public function recordOutcome(string $status, string $message, ?int $occurrence, ?BbTicketInterface $ticket, ?int $nextRun, int $attempts): void;

}
