<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

/**
 * Defines the interface for bakers.build run entities.
 *
 * A run represents a single execution attempt of a ticket by a conductor.  It
 * records the lifecycle state of that attempt (claimed → running → done), the
 * identity of the processing conductor, and the claim lease
 * expiry timestamp that prevents stale runs from blocking the dispatch queue.
 */
interface BbRunInterface extends BbContentEntityInterface {

  /**
   * Returns the entity ID of the ticket this run is processing, or NULL.
   *
   * @return int|null
   *   The ticket entity ID, or NULL if not set.
   */
  public function getTicketId(): ?int;

  /**
   * Returns the loaded ticket entity for this run, or NULL if absent.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface|null
   *   The ticket entity, or NULL.
   */
  public function getTicket(): ?BbTicketInterface;

  /**
   * Returns the current lifecycle state of this run.
   *
   * @return string
   *   One of 'claimed', 'running', 'done', or the terminal 'expired'.
   */
  public function getRunState(): string;

  /**
   * Sets the lifecycle state of this run.
   *
   * @param string $state
   *   The new state machine value.
   *
   * @return static
   */
  public function setRunState(string $state): static;

  /**
   * Returns the Unix timestamp at which the claim lease on this run expires.
   *
   * @return int|null
   *   The expiry timestamp, or NULL if no lease has been set.
   */
  public function getClaimExpiresAt(): ?int;

  /**
   * Returns the Unix timestamp of the last conductor heartbeat for this run.
   *
   * This value is telemetry only and never drives reclaim logic.
   *
   * @return int|null
   *   The heartbeat timestamp, or NULL if no heartbeat has been recorded.
   */
  public function getHeartbeat(): ?int;

  /**
   * Records a conductor heartbeat timestamp for this run.
   *
   * @param int $timestamp
   *   Unix timestamp of the heartbeat observation.
   *
   * @return static
   *   The called object, for method chaining.
   */
  public function setHeartbeat(int $timestamp): static;

  /**
   * Whether the run is finalised (transcript captured, wound up).
   */
  public function isClosed(): bool;

  /**
   * The finalisation timestamp, or NULL if not yet closed.
   */
  public function getClosedDate(): ?int;

  /**
   * Marks the run closed at the given timestamp (sets closed + closed_date).
   */
  public function markClosed(int $timestamp): static;

  /**
   * The failure detail recorded when the run terminalised to failed, or NULL.
   *
   * @throws \Drupal\bb_core\RunLog\RunLogException
   *   If the stored error log exists but cannot be read (review finding M6).
   *   There is no decryption step: revision 2 of the specification withdrew
   *   encryption, so these are private files rather than ciphertext.
   */
  public function getErrorLog(): ?string;

  /**
   * Records the failure detail for a run terminalised to the failed state.
   */
  public function setErrorLog(string $error_log): static;

  /**
   * Returns the run transcript, or NULL when none was captured.
   *
   * Deliberately a method and not a field: a caller has to ask for the
   * payload by name, so no ordinary entity load, render or index pass can
   * pull it in by accident.
   *
   * @throws \Drupal\bb_core\RunLog\RunLogException
   */
  public function readLog(): ?string;

  /**
   * Returns the error log, or NULL when none was captured.
   *
   * @throws \Drupal\bb_core\RunLog\RunLogException
   */
  public function readErrorLog(): ?string;

  /**
   * One-line reason a failed run failed, or NULL for any other state.
   *
   * The first non-empty error-log line without a leading "Error: ", cut at 140
   * characters; a failed run with no or an unreadable error log gets the
   * no-reason copy. Never throws.
   */
  public function failureReason(): ?string;

  /**
   * The failure reason before it is cut, for the full line on hover.
   *
   * The first non-empty error-log line without a leading "Error: ", or the
   * no-reason copy; NULL for any state but failed. Never throws.
   */
  public function failureLine(): ?string;

}
