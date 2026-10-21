<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;

/**
 * The lifecycle rules `BbTicket::preSave()` applies on every save.
 *
 * Static and separate from the entity for the same reason as `BranchName`.
 *.
 *
 * @see \Drupal\bb_core\Entity\BbTicket::preSave()
 */
final class TicketClosure {

  /**
   * Closes a terminal ticket on save.
   *
   * Level-triggered, not edge-triggered: the guard is *state is terminal
   * **and** `closed` is falsy*, never *state changed to terminal in this
   * save*. This is what makes `closed` a self-healing projection of
   * terminality — a row whose `closed` was cleared by hand is re-closed on its
   * next save — and it holds for every write path (JSON:API, dropsh, the web
   * UI, Drush, a raw `--state` write over an edge the workflow does not
   * define), because it lives in the entity's own save rather than in a
   * dispatched transition event.
   *
   * It only ever SETS `closed`. A ticket that leaves a terminal state by a
   * raw write keeps `closed = 1`; `cancelIfClosedNonTerminal()` then lands
   * that row in `cancelled` so closed never stays on a living state.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being saved.
   */
  public static function closeIfTerminal(BbTicketInterface $ticket): void {
    if ($ticket->get('closed')->value) {
      return;
    }
    $workflow = $ticket->getWorkflow();
    if ($workflow === '') {
      return;
    }
    if (!TypeWorkflows::isTerminal($workflow, (string) $ticket->get('state')->value)) {
      return;
    }
    $ticket->markClosed(\Drupal::time()->getRequestTime());
  }

  /**
   * Cancels a closed non-terminal ticket and stamps a missing `closed_date`.
   *
   * Inverse of closeIfTerminal(): `closed` is only true of a terminal state.
   * A client write that sets `closed` on a living ticket — JSON:API, dropsh,
   * a script — lands in `cancelled`. Entity preSave runs before the state
   * field's preSave, so `cancel` still dispatches and retires open runs.
   * Level-triggered: a stored-closed non-terminal row heals on its next save.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being saved.
   */
  public static function cancelIfClosedNonTerminal(BbTicketInterface $ticket): void {
    if (!$ticket->get('closed')->value) {
      return;
    }
    $workflow = $ticket->getWorkflow();
    if ($workflow !== '' && !TypeWorkflows::isTerminal($workflow, (string) $ticket->get('state')->value)) {
      $ticket->set('state', 'cancelled');
    }
    if ($ticket->getClosedDate() === NULL) {
      $ticket->set('closed_date', \Drupal::time()->getRequestTime());
    }
  }

  /**
   * Coerces an explicit NULL on `cleaned_up` to FALSE.
   *
   * Runs on both create and update so Drupal stops producing the NULL rows
   * the historical backfill has to resolve; `cleaned_up` keeps meaning "not
   * yet torn down" rather than "unknown".
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being saved.
   */
  public static function coerceCleanedUpNull(BbTicketInterface $ticket): void {
    if ($ticket->get('cleaned_up')->value === NULL) {
      $ticket->set('cleaned_up', FALSE);
    }
  }

  /**
   * Coerces an explicit NULL on `frozen` to FALSE.
   *
   * The claim query filters `frozen = 0`, which never matches SQL NULL, so a
   * `"frozen": null` write would leave a ticket unclaimable while it reads as
   * not frozen.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being saved.
   */
  public static function coerceFrozenNull(BbTicketInterface $ticket): void {
    if ($ticket->get('frozen')->value === NULL) {
      $ticket->set('frozen', FALSE);
    }
  }

  /**
   * Stamps `cleaned_up_date` the first time `cleaned_up` becomes TRUE (D2).
   *
   * The guard is "cleaned_up is TRUE and no date is stored yet" rather than a
   * comparison against the previous value: once a date is stored it is never
   * empty again, so a second save with `cleaned_up` still TRUE is already a
   * no-op through the same condition. The server stamps it — the conductor's
   * write stays exactly `{ cleaned_up: true }`, so no conductor host's clock
   * enters the record.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being saved.
   */
  public static function stampCleanedUpDate(BbTicketInterface $ticket): void {
    if (!$ticket->get('cleaned_up')->value || !$ticket->get('cleaned_up_date')->isEmpty()) {
      return;
    }
    $ticket->set('cleaned_up_date', \Drupal::time()->getRequestTime());
  }

  /**
   * Keeps `frozen_at` in lockstep with `frozen`.
   *
   * Freeze writes `{ frozen: true }`; the server stamps the time. Unfreeze
   * clears the stamp. A later save of an already-frozen ticket keeps the
   * original time, so the badge says when the hold started, not when the
   * ticket was last saved.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket being saved.
   */
  public static function stampFrozenAt(BbTicketInterface $ticket): void {
    if (!$ticket->isFrozen()) {
      if ($ticket->getFrozenAt() !== NULL) {
        $ticket->set('frozen_at', NULL);
      }
      return;
    }
    if ($ticket->getFrozenAt() !== NULL) {
      return;
    }
    $ticket->set('frozen_at', \Drupal::time()->getRequestTime());
  }

}
