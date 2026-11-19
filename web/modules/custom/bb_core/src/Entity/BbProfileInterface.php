<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * One account's profile in one workspace.
 */
interface BbProfileInterface extends ContentEntityInterface, EntityOwnerInterface {

  /**
   * The workspace entity id.
   */
  public function workspaceId(): int;

  /**
   * The position, e.g. "Backend engineer"; empty when unset.
   */
  public function position(): string;

  /**
   * Sets the position.
   */
  public function setPosition(string $position): static;

  /**
   * What bakers.build should know about the account's background.
   */
  public function background(): string;

  /**
   * Sets the background.
   */
  public function setBackground(string $background): static;

  /**
   * The favorite bb_project ids, as stored; unchecked for access or existence.
   *
   * @return int[]
   *   The project ids.
   */
  public function favoriteProjectIds(): array;

  /**
   * Adds the project to the favorites, or removes it when present.
   */
  public function toggleFavorite(int $project_id): static;

}
