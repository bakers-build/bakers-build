<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

/**
 * Defines the interface for bakers.build project entities.
 *
 * A project belongs to a group and to at least one team, and encapsulates the
 * source repositories and the coder configuration. It has no membership of
 * its own; visibility comes from its teams.
 */
interface BbProjectInterface extends BbContentEntityInterface {

  /**
   * Returns the short project key used to build ticket identifiers.
   *
   * @return string
   *   The uppercase project key, e.g. "bakers.build".
   */
  public function getKey(): string;

  /**
   * Returns the human-readable name of this project.
   *
   * @return string
   *   The project name.
   */
  public function getName(): string;

  /**
   * Sets the human-readable name of this project.
   *
   * @param string $name
   *   The name to assign.
   *
   * @return static
   */
  public function setName(string $name): static;

  /**
   * Returns the entity ID of the owning group, or NULL if not set.
   *
   * @return int|null
   *   The group entity ID, or NULL.
   */
  public function getGroupId(): ?int;

  /**
   * Returns the loaded group entity for this project, or NULL if absent.
   *
   * @return \Drupal\bb_core\Entity\BbGroupInterface|null
   *   The group entity, or NULL.
   */
  public function getGroup(): ?BbGroupInterface;

  /**
   * Returns the teams this project belongs to.
   *
   * A project belongs to at least one team. The list is the stored side of
   * the relationship; the inverse — a team's projects — is computed from it.
   *
   * @return array<\Drupal\bb_core\Entity\BbTeamInterface>
   *   The referenced teams, in field order; empty only for an invalid project.
   */
  public function getTeams(): array;

  /**
   * Draws and reserves the next running ticket number for this project.
   *
   * Reads `next_number` under a `FOR UPDATE` row lock and bumps the stored
   * counter by one, so concurrent allocations stay distinct and gapless. The
   * counter only ever increments — deleted tickets never lower it, so numbers
   * are never reused.
   *
   * @return int
   *   The reserved number (>= 1), to be frozen into the ticket.
   */
  public function allocateNextNumber(): int;

}
