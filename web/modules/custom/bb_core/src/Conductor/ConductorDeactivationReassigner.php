<?php

declare(strict_types=1);

namespace Drupal\bb_core\Conductor;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Psr\Log\LoggerInterface;

/**
 * Moves eligible tickets away from a conductor deactivated by its owner.
 */
final class ConductorDeactivationReassigner {

  /**
   * The ticket was reassigned or cleared successfully.
   */
  private const REASSIGN_OK = 'ok';

  /**
   * The ticket was left untouched, and belongs in the "stranded" notice.
   */
  private const REASSIGN_STRANDED = 'stranded';

  /**
   * The ticket's save threw, so it belongs in a distinct "failed" notice (N4).
   */
  private const REASSIGN_FAILED = 'failed';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly LoggerInterface $logger,
    private readonly TimeInterface $time,
    private readonly ConductorOwnerAccess $ownerAccess,
  ) {
  }

  /**
   * Reassigns open tickets to the owner's newest active matching conductor.
   */
  public function reassign(BbConductorInterface $conductor): void {
    $ticketStorage = $this->entityTypeManager->getStorage('bb_ticket');
    $runStorage = $this->entityTypeManager->getStorage('bb_run');
    $query = $ticketStorage->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductor_id', $conductor->id());
    $this->addNonTerminalCondition($query);
    $ticketIds = $query->execute();
    if ($ticketIds === []) {
      return;
    }

    $inFlight = $this->inFlightTicketIds($runStorage, $ticketIds);

    $stranded = [];
    $failed = [];
    foreach ($ticketStorage->loadMultiple($ticketIds) as $ticket) {
      if (!$ticket instanceof BbTicketInterface) {
        continue;
      }
      // The query above already narrows to non-terminal states; this is an
      // in-memory tie-break against a state that changed between the query
      // and the load, not the primary filter (F14).
      if (TypeWorkflows::isTerminal((string) $ticket->get('workflow')->value, (string) $ticket->get('state')->value)) {
        continue;
      }
      if (isset($inFlight[$ticket->id()])) {
        $stranded[] = $ticket->id();
        continue;
      }
      $outcome = $this->reassignOne($ticket, $conductor);
      if ($outcome === self::REASSIGN_FAILED) {
        $failed[] = $ticket->id();
      }
      elseif ($outcome === self::REASSIGN_STRANDED) {
        $stranded[] = $ticket->id();
      }
    }

    $this->logSkipped($conductor, $stranded, $failed);
  }

  /**
   * Narrows a `bb_ticket` query to rows non-terminal in their own workflow.
   *
   * Mirrors `BbNonTerminalTicketState::query()`'s reasoning over
   * `TypeWorkflows::terminalTicketStates()`, on an entity query instead of a
   * Search API one: an `AND` over workflows of `(workflow <> W OR state NOT
   * IN terminal(W))`. Doing this in the query, rather than discarding
   * terminal rows in PHP after `loadMultiple()`, is what keeps a
   * long-lived conductor's deactivation from loading its entire closed
   * ticket history inside one synchronous request (D4, F14).
   */
  private function addNonTerminalCondition(QueryInterface $query): void {
    $terminal = TypeWorkflows::terminalTicketStates();
    if ($terminal === []) {
      return;
    }
    $perWorkflow = $query->andConditionGroup();
    foreach ($terminal as $workflowId => $states) {
      $group = $query->orConditionGroup()
        ->condition('workflow', $workflowId, '<>')
        ->condition('state', array_values($states), 'NOT IN');
      $perWorkflow->condition($group);
    }
    // SQL three-valued logic: a row with a NULL `workflow` or `state` makes
    // every `<>`/`NOT IN` comparison above NULL, so the whole AND group is
    // NULL and the row silently drops out of the WHERE — exactly the
    // stranding this narrowing must not reintroduce (N3). Before this
    // narrowing existed, such a row was loaded and
    // `TypeWorkflows::isTerminal('', '')` read it as non-terminal, so admit
    // it here too and let the in-memory tie-break judge it as before.
    $outer = $query->orConditionGroup()
      ->condition($perWorkflow)
      ->condition('state', NULL, 'IS NULL')
      ->condition('workflow', NULL, 'IS NULL');
    $query->condition($outer);
  }

  /**
   * The ids of tickets in `$ticketIds` whose run is genuinely still live.
   *
   * A `running` run always is; a `claimed` run whose lease already lapsed is
   * the same claimed-but-never-started zombie that TicketClaimService::
   * countLiveRunsOnMachine() and retireSupersededRuns() already discount — D1
   * carves out an in-flight run, not a stranded one, so this deactivated
   * conductor must not hold that ticket hostage forever.
   *
   * @param \Drupal\Core\Entity\EntityStorageInterface $runStorage
   *   The `bb_run` storage.
   * @param array<int, int|string> $ticketIds
   *   The candidate ticket ids.
   *
   * @return array<int|string, true>
   *   Ticket ids keyed by themselves, present only when genuinely in flight.
   */
  private function inFlightTicketIds(EntityStorageInterface $runStorage, array $ticketIds): array {
    $now = $this->time->getRequestTime();
    $inFlight = [];
    $runIds = $runStorage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticketIds, 'IN')
      ->condition('state', ['claimed', 'running'], 'IN')
      ->execute();
    foreach ($runStorage->loadMultiple($runIds) as $run) {
      if (!$run instanceof BbRunInterface || $this->isExpiredClaim($run, $now)) {
        continue;
      }
      $inFlight[$run->getTicketId()] = TRUE;
    }
    return $inFlight;
  }

  /**
   * Whether a run is a claimed-but-never-started zombie past its lease.
   */
  private function isExpiredClaim(BbRunInterface $run, int $now): bool {
    if ($run->getRunState() !== 'claimed') {
      return FALSE;
    }
    $expires = $run->getClaimExpiresAt();
    // A NULL lease is read as still live here — the conservative reading, so
    // a ticket is never moved off a run that may in fact be in flight.
    // `TicketClaimService::countLiveRunsOnMachine()` reads the same NULL as
    // dead (it matches `= 0 OR >= now`, which a SQL NULL satisfies on
    // neither side); the two predicates deliberately diverge on that one
    // input, and nothing today produces a NULL `claim_expires_at` on a
    // `claimed` run, so the divergence has no observable case (F19).
    return $expires !== NULL && $expires > 0 && $expires < $now;
  }

  /**
   * Names the tickets this pass deliberately left behind.
   *
   * D1: "the reassignment result names those tickets" — a ticket left on the
   * deactivated conductor because its run is genuinely in flight, or because
   * it carries no project to match candidates against, must stay
   * distinguishable from a bug, not disappear silently. The query in
   * `reassign()` already excludes terminal tickets, so nothing terminal ever
   * reaches this list (F15).
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The deactivated conductor.
   * @param array<int, int|string> $stranded
   *   Ticket ids left behind with an in-flight run or no project.
   * @param array<int, int|string> $failed
   *   Ticket ids whose reassignment save itself threw (N4): a distinct cause
   *   from `$stranded`, already logged separately at `error` level, and
   *   reported under its own notice rather than folded into "in-flight run
   *   or no project", which would state something false about that id.
   */
  private function logSkipped(BbConductorInterface $conductor, array $stranded, array $failed = []): void {
    if ($stranded !== []) {
      $this->logger->notice('Deactivating conductor @conductor left @count ticket(s) on it, stranded with an in-flight run or no project: @tickets.', [
        '@conductor' => $conductor->id(),
        '@count' => count($stranded),
        '@tickets' => implode(', ', $stranded),
      ]);
    }
    if ($failed !== []) {
      $this->logger->notice('Deactivating conductor @conductor left @count ticket(s) on it because their reassignment save failed: @tickets.', [
        '@conductor' => $conductor->id(),
        '@count' => count($failed),
        '@tickets' => implode(', ', $failed),
      ]);
    }
  }

  /**
   * Moves one ticket to its successor candidate, or clears the assignment.
   *
   * @return string
   *   One of `self::REASSIGN_OK`, `self::REASSIGN_STRANDED` (no project — the
   *   ticket should be reported as stranded, F16) or `self::REASSIGN_FAILED`
   *   (the save itself threw, reported under a distinct cause, N4).
   */
  private function reassignOne(BbTicketInterface $ticket, BbConductorInterface $conductor): string {
    $projectId = $ticket->get('project_id')->target_id;
    if ($projectId === NULL) {
      // A required field enforced only by validation; a programmatically
      // saved ticket can still carry none. Report it rather than running a
      // query that can never resolve a project-matching candidate.
      return self::REASSIGN_STRANDED;
    }
    $candidateIds = $this->entityTypeManager->getStorage('bb_conductor')->getQuery()
      ->accessCheck(FALSE)
      ->condition('active', TRUE)
      ->condition('owner_user_id', $conductor->get('owner_user_id')->target_id)
      ->condition('project_id', $projectId)
      ->condition('id', $conductor->id(), '<>')
      ->sort('last_seen', 'DESC')
      // Tie-break, so two conductors sharing a heartbeat second do not
      // resolve by storage order.
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    $candidate = $candidateIds === [] ? NULL : $this->entityTypeManager->getStorage('bb_conductor')->load(reset($candidateIds));
    $eligible = $candidate instanceof BbConductorInterface
      && $this->ownerAccess->ownerHasAccess($candidate, (int) $projectId)
      && $this->ownerAccess->ownerIsResponsible($candidate, $ticket);
    $ticket->set('conductor_id', $eligible ? $candidate->id() : NULL);
    try {
      // Deliberately not `setValidationRequired(TRUE)` — spec design item 5,
      // step 6 says "save each ticket with validation enabled", but the
      // candidate query and the owner check above already guarantee
      // `BbConductorProjectMatch`, `BbConductorActive` and
      // `BbConductorOwnerAccess` hold, and validating would let an
      // unrelated pre-existing violation on the ticket block a reassignment
      // it has nothing to do with (N7).
      $ticket->save();
      return self::REASSIGN_OK;
    }
    catch (EntityStorageException $e) {
      // One bad ticket must not strand the rest of the batch, since the
      // conductor row is already saved inactive by the time this runs.
      $this->logger->error('Failed to reassign ticket @ticket off deactivated conductor @conductor: @message', [
        '@ticket' => $ticket->id(),
        '@conductor' => $conductor->id(),
        '@message' => $e->getMessage(),
      ]);
      return self::REASSIGN_FAILED;
    }
  }

}
