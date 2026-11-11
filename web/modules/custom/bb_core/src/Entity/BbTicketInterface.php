<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use Drupal\user\UserInterface;

/**
 * Defines the interface for bakers.build ticket entities.
 *
 * A ticket represents a unit of work tracked through a state-machine workflow
 * selected via its `workflow` field. The interface exposes the ticket's
 * identity fields, its workflow state, dispatch-related metadata such as
 * priority, and the blocker graph used to determine eligibility for processing.
 */
interface BbTicketInterface extends BbContentEntityInterface {

  /**
   * Returns the human-readable unique identifier of this ticket (e.g. PRJ-42).
   *
   * @return string
   *   The ticket identifier string.
   */
  public function getIdentifier(): string;

  /**
   * Sets the unique identifier of this ticket.
   *
   * @param string $identifier
   *   The identifier to assign.
   *
   * @return static
   */
  public function setIdentifier(string $identifier): static;

  /**
   * Returns the workflow plugin ID selected for this ticket.
   *
   * @return string
   *   The workflow machine name (e.g. 'bb_work').
   */
  public function getWorkflow(): string;

  /**
   * Returns the human-readable title of this ticket.
   *
   * @return string
   *   The ticket title.
   */
  public function getTitle(): string;

  /**
   * Sets the human-readable title of this ticket.
   *
   * @param string $title
   *   The title to assign.
   *
   * @return static
   */
  public function setTitle(string $title): static;

  /**
   * Returns the state-machine field item for this ticket's current state.
   *
   * @return \Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface
   *   The state item, which can be used to apply transitions.
   */
  public function getState(): StateItemInterface;

  /**
   * Returns the entity ID of the project this ticket belongs to, or NULL.
   *
   * @return int|null
   *   The project entity ID, or NULL if not set.
   */
  public function getProjectId(): ?int;

  /**
   * Returns the loaded project entity for this ticket, or NULL if absent.
   *
   * @return \Drupal\bb_core\Entity\BbProjectInterface|null
   *   The project entity, or NULL.
   */
  public function getProject(): ?BbProjectInterface;

  /**
   * Returns the conductor this ticket is assigned to, or NULL if unassigned.
   *
   * Conductor assignment is the explicit signal that starts a run; the user
   * assignee is human ownership only and does not affect claiming.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface|null
   *   The assigned conductor entity, or NULL.
   */
  public function getConductor(): ?BbConductorInterface;

  /**
   * Whether a conductor currently holds this ticket.
   *
   * Occupancy, independent of whether the referenced conductor entity still
   * loads. TRUE when `conductor_id` is set, including a dangling reference
   * whose target is missing. The Project Board uses this for column placement:
   * a dangling conductor stays occupied (Working, or Intake when the state is
   * qualification).
   *
   * @return bool
   *   TRUE when `conductor_id` is set.
   */
  public function hasBbConductor(): bool;

  /**
   * Assigns this ticket to a conductor (or clears the assignment with NULL).
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface|null $conductor
   *   The conductor to assign, or NULL to clear.
   *
   * @return static
   */
  public function setConductor(?BbConductorInterface $conductor): static;

  /**
   * Returns the dispatch priority of this ticket, or NULL if not set.
   *
   * Lower numeric values indicate higher priority.
   *
   * @return int|null
   *   The priority value, or NULL.
   */
  public function getPriority(): ?int;

  /**
   * Returns whether this ticket currently has at least one unresolved blocker.
   *
   * @return bool
   *   TRUE if any blocking ticket is still open, FALSE otherwise.
   */
  public function hasOpenBlockers(): bool;

  /**
   * Returns the entity ID of the parent ticket, or NULL for top-level tickets.
   *
   * @return int|null
   *   The parent ticket entity ID, or NULL.
   */
  public function getParentId(): ?int;

  /**
   * Returns the entity IDs of all tickets that block this ticket.
   *
   * @return int[]
   *   An indexed array of blocking ticket entity IDs.
   */
  public function getBlockedByIds(): array;

  /**
   * Returns the tickets carried by this deployment (the release batch).
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface[]
   *   The referenced ticket entities (may be empty).
   */
  public function getReferencedTickets(): array;

  /**
   * Whether conductors must skip this ticket at the next claim.
   */
  public function isFrozen(): bool;

  /**
   * Sets whether conductors must skip this ticket at the next claim.
   */
  public function setFrozen(bool $frozen): static;

  /**
   * When the operator hold started, or NULL if the ticket is not frozen.
   *
   * Stamped by the server on the save that sets {@see isFrozen()} TRUE,
   * cleared on unfreeze. Clients write `frozen`; they never write this.
   */
  public function getFrozenAt(): ?int;

  /**
   * When the ticket was last restarted, or NULL if never.
   *
   * The failed-run circuit breaker counts only runs created after it.
   */
  public function getRestartedAt(): ?int;

  /**
   * Who last restarted the ticket, or NULL if never or the account is gone.
   */
  public function getRestartedBy(): ?UserInterface;

  /**
   * Whether the ticket is finalised (transcript captured, wound up).
   */
  public function isClosed(): bool;

  /**
   * The finalisation timestamp, or NULL if not yet closed.
   */
  public function getClosedDate(): ?int;

  /**
   * Marks the ticket closed at the given timestamp (sets closed + closed_date).
   */
  public function markClosed(int $timestamp): static;

  /**
   * Whether the ticket's herdr worktree has been torn down (infra teardown).
   *
   * Distinct from {@see isClosed()}: `closed` is the ticket lifecycle, this is
   * the worktree teardown. A teardown miss keeps this FALSE (retried by the
   * conductor reaper) without withholding the close.
   */
  public function isCleanedUp(): bool;

  /**
   * Marks the ticket's worktree torn down (sets cleaned_up = TRUE).
   */
  public function markCleanedUp(): static;

  /**
   * The cleanup timestamp, or NULL if not yet cleaned up.
   *
   * Stamped by the server, on the save that flips {@see isCleanedUp()} from
   * falsy to TRUE — never by the client, so no conductor host's clock enters
   * the record.
   */
  public function getCleanedUpDate(): ?int;

}
