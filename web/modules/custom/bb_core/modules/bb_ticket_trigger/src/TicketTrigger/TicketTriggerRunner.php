<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface as Trigger;
use Drupal\bb_ticket_trigger\Plugin\Validation\Constraint\BbTicketTriggerActorConstraintValidator;
use Psr\Log\LoggerInterface;

/**
 * Runs triggers: exactly one action per occurrence, as the service account.
 *
 * Each run row-locks the trigger and writes the action's effect and the
 * replay key `last_occurrence` in one transaction, so a repeated delivery of
 * an occurrence either sees both (and skips) or neither (and acts once). The
 * action and its failure classes are the target plugin's (for `template`:
 * TicketTemplateInstantiator); nothing here knows a target type.
 */
final class TicketTriggerRunner {

  /**
   * Attempts per occurrence before a transient failure becomes final.
   */
  public const MAX_ATTEMPTS = 3;

  /**
   * Upper bound when walking missed occurrences forward.
   */
  private const MAX_MISSED = 1000;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly Connection $database,
    private readonly TimeInterface $time,
    private readonly TicketTriggerTypePluginManager $typeManager,
    private readonly LoggerInterface $logger,
  ) {}

  /**
   * Runs every enabled trigger whose next occurrence is due (cron).
   */
  public function runDue(): void {
    $storage = $this->entityTypeManager->getStorage('bb_ticket_trigger');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('enabled', 1)
      ->condition('next_run', $this->time->getCurrentTime(), '<=')
      ->sort('next_run')
      ->execute();
    foreach ($storage->loadMultiple($ids) as $trigger) {
      if (!$trigger instanceof Trigger) {
        continue;
      }
      // One trigger's failure (e.g. a deadlock) must not starve the others.
      try {
        $this->run($trigger);
      }
      catch (\Throwable $e) {
        $this->logger->error('Ticket trigger @id aborted: @message', [
          '@id' => $trigger->id(),
          '@message' => $e->getMessage(),
        ]);
      }
    }
  }

  /**
   * Runs a scheduled trigger's latest due occurrence, if any.
   *
   * @return string
   *   The recorded status, or '' when nothing was due.
   */
  public function run(Trigger $trigger): string {
    return $this->locked($trigger, function (Trigger $trigger): string {
      $now = $this->time->getCurrentTime();
      $next = $trigger->getNextRun();
      if ($next === NULL || $next > $now) {
        return '';
      }
      // Older missed occurrences are skipped, not backfilled.
      $type = $trigger->getTypePlugin();
      $occurrence = $next;
      $skipped = 0;
      $following = $type->nextOccurrence($this->instant($occurrence));
      while ($following !== NULL && $following->getTimestamp() <= $now && $skipped < self::MAX_MISSED) {
        $occurrence = $following->getTimestamp();
        $skipped++;
        $following = $type->nextOccurrence($following);
      }
      $note = $skipped > 0 ? sprintf(' %d missed occurrence(s) skipped.', $skipped) : '';
      return $this->process($trigger, $occurrence, $following?->getTimestamp(), $note);
    });
  }

  /**
   * Fires one occurrence of an event-driven trigger.
   *
   * @param \Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface $trigger
   *   The trigger.
   * @param int $occurrence
   *   The event's key, growing over time; a key at or below the last handled
   *   one is a replay. A `retrying` outcome leaves redelivery of the same key
   *   to the caller.
   *
   * @return string
   *   The recorded status, or '' when the trigger is paused.
   */
  public function fire(Trigger $trigger, int $occurrence): string {
    return $this->locked($trigger, fn (Trigger $trigger): string => $this->process($trigger, $occurrence, $trigger->getNextRun(), ''));
  }

  /**
   * Runs $work on the row-locked, freshly loaded trigger in a transaction.
   *
   * @param \Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface $trigger
   *   The trigger.
   * @param callable(\Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface): string $work
   *   The work.
   */
  private function locked(Trigger $trigger, callable $work): string {
    $transaction = $this->database->startTransaction();
    try {
      $select = $this->database->select('bb_ticket_trigger', 't');
      $select->fields('t', ['id']);
      $select->condition('id', $trigger->id());
      $select->forUpdate();
      $select->execute()?->fetchField();
      $fresh = $this->entityTypeManager->getStorage('bb_ticket_trigger')->loadUnchanged($trigger->id());
      if (!$fresh instanceof Trigger || !$fresh->isEnabled()) {
        return '';
      }
      return $work($fresh);
    }
    catch (\Throwable $e) {
      $transaction->rollBack();
      throw $e;
    }
  }

  /**
   * Handles one occurrence and records its outcome.
   */
  private function process(Trigger $trigger, int $occurrence, ?int $following, string $note): string {
    $last = $trigger->getLastOccurrence();
    if ($last !== NULL && $occurrence <= $last) {
      $trigger->recordOutcome(Trigger::STATUS_SKIPPED, 'Occurrence already handled.' . $note, NULL, NULL, $following, $trigger->getAttempts());
      return Trigger::STATUS_SKIPPED;
    }

    $problem = $this->unavailableReason($trigger);
    if ($problem !== NULL) {
      // Not retried: the trigger stays enabled so the problem stays visible,
      // and the schedule moves on so cron does not spin on it.
      $this->logger->warning('Ticket trigger @id unavailable: @reason', ['@id' => $trigger->id(), '@reason' => $problem]);
      $trigger->recordOutcome(Trigger::STATUS_UNAVAILABLE, $problem . $note, NULL, NULL, $following, 0);
      return Trigger::STATUS_UNAVAILABLE;
    }

    $actor = $trigger->getActor();
    assert($actor !== NULL);
    try {
      $result = $trigger->getTargetPlugin()->execute($trigger, $actor);
    }
    catch (\Throwable $e) {
      return $this->recordFailure($trigger, $e, $occurrence, $following, $note);
    }
    $trigger->recordOutcome(Trigger::STATUS_SUCCESS, $result->message . $note, $occurrence, $result->ticket, $following, 0);
    return Trigger::STATUS_SUCCESS;
  }

  /**
   * Records a failed creation: final, or retrying the same occurrence.
   */
  private function recordFailure(Trigger $trigger, \Throwable $e, int $occurrence, ?int $following, string $note): string {
    $this->logger->error('Ticket trigger @id failed: @message', [
      '@id' => $trigger->id(),
      '@message' => $e->getMessage(),
    ]);
    $attempts = $trigger->getAttempts() + 1;
    if (!$trigger->getTargetPlugin()->isPermanentFailure($e) && $attempts < self::MAX_ATTEMPTS) {
      $message = sprintf('Attempt %d of %d failed: %s', $attempts, self::MAX_ATTEMPTS, $e->getMessage());
      $trigger->recordOutcome(Trigger::STATUS_RETRYING, $message . $note, NULL, NULL, $trigger->getNextRun(), $attempts);
      return Trigger::STATUS_RETRYING;
    }
    $trigger->recordOutcome(Trigger::STATUS_FAILED, $e->getMessage() . $note, $occurrence, NULL, $following, 0);
    return Trigger::STATUS_FAILED;
  }

  /**
   * Why the trigger cannot run at all, or NULL when it can.
   */
  private function unavailableReason(Trigger $trigger): ?string {
    if (!$this->typeManager->hasDefinition($trigger->getType())) {
      return sprintf('Unavailable trigger type: %s.', $trigger->getType());
    }
    if ($trigger->getTarget() === NULL) {
      return 'The trigger has no target.';
    }
    if (!BbTicketTriggerActorConstraintValidator::isActiveServiceAccountOf($trigger->getActor(), $trigger->getWorkspace())) {
      return 'The service account is missing, blocked or not of this workspace.';
    }
    return NULL;
  }

  /**
   * A timestamp as a UTC instant.
   */
  private function instant(int $timestamp): \DateTimeImmutable {
    return new \DateTimeImmutable('@' . $timestamp);
  }

}
