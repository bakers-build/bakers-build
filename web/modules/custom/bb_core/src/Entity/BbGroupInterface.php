<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

/**
 * Defines the interface for bakers.build group entities.
 *
 * A group is the top-level billing and organisational unit that owns one or
 * more bakers.build projects.  The interface exposes name access and a structured
 * billing profile that is stored as a serialised key–value map.
 */
interface BbGroupInterface extends BbContentEntityInterface {

  /**
   * Returns the human-readable name of this group.
   *
   * @return string
   *   The group name.
   */
  public function getName(): string;

  /**
   * Sets the human-readable name of this group.
   *
   * @param string $name
   *   The name to assign.
   *
   * @return static
   */
  public function setName(string $name): static;

  /**
   * Returns the billing profile data stored for this group.
   *
   * @return array<string, mixed>
   *   An associative array of billing profile key–value pairs, or an empty
   *   array if no billing profile has been saved yet.
   */
  public function getBillingProfile(): array;

  /**
   * Returns the workspace this group belongs to.
   *
   * The reference is required, but as a validation constraint
   * rather than a NOT NULL column — a row written before the migration ran can
   * still be empty, so this returns NULL rather than pretending otherwise.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface|null
   *   The workspace, or NULL if this group has not been placed in one.
   */
  public function getWorkspace(): ?BbWorkspaceInterface;

}
