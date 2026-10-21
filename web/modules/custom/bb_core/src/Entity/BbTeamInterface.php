<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

/**
 * Defines the interface for bakers.build team entities.
 *
 * A team is a workspace-scoped crew that cuts across customer projects and
 * is their structural parent: a project belongs to at least one team, and
 * team membership decides which projects an account sees. Permissions still
 * come from the workspace rank.
 */
interface BbTeamInterface extends BbContentEntityInterface {

  /**
   * Returns the human-readable name of this team.
   *
   * @return string
   *   The team name.
   */
  public function getName(): string;

  /**
   * Sets the human-readable name of this team.
   *
   * @param string $name
   *   The name to assign.
   *
   * @return static
   */
  public function setName(string $name): static;

  /**
   * Returns the projects assigned to this team.
   *
   * Derived from `bb_project.teams` and never stored here, so
   * the two directions cannot disagree.
   *
   * @return array<\Drupal\bb_core\Entity\BbProjectInterface>
   *   The assigned projects, ordered by name.
   */
  public function getProjects(): array;

}
