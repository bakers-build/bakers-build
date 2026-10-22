<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

/**
 * Defines the interface for bakers.build workspace entities.
 *
 * A workspace is the tenancy root: the operator whose data a group, its
 * projects, tickets and runs belong to, and the first level at which people
 * hold a role. It carries its own billing profile — the contract or
 * subscription — which is a different thing from the group's cost centre.
 */
interface BbWorkspaceInterface extends BbContentEntityInterface {

  /**
   * Returns the human-readable name of this workspace.
   *
   * @return string
   *   The workspace name.
   */
  public function getName(): string;

  /**
   * Sets the human-readable name of this workspace.
   *
   * @param string $name
   *   The name to assign.
   *
   * @return static
   */
  public function setName(string $name): static;

  /**
   * Returns the URL handle of this workspace.
   *
   * The slug is the first path segment of every bakers.build product URL —
   * `bakers` in `/bakers/tickets`. It is authored, not derived from the name.
   *
   * The site root is NOT one of those URLs. `system.site.front` is `/home`,
   * a route that carries no workspace and resolves the reader's own; the slug
   * appears in the address only once a workspace has been chosen.
   *
   * @return string
   *   The workspace slug, or an empty string when none is stored yet.
   */
  public function getSlug(): string;

  /**
   * Sets the URL handle of this workspace.
   *
   * @param string $slug
   *   The slug to assign. Validated by the BbWorkspaceSlug constraint.
   *
   * @return static
   */
  public function setSlug(string $slug): static;

  /**
   * Returns the billing profile data stored for this workspace.
   *
   * @return array<string, mixed>
   *   An associative array of billing profile key-value pairs, or an empty
   *   array if no billing profile has been saved yet.
   */
  public function getBillingProfile(): array;

}
