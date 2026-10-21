<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

/**
 * Defines the interface for bakers.build environment entities.
 *
 * An environment is a managed deployment target (dev2, prod, …) with its own
 * URL and tier. It belongs to exactly one project and is unique per project.
 * Environments are not created directly — they are provisioned programmatically
 * (recipe/connector) and surfaced on their project.
 */
interface BbEnvironmentInterface extends BbContentEntityInterface {

  /**
   * Returns the environment name (its label).
   *
   * @return string
   *   The environment name.
   */
  public function getName(): string;

  /**
   * Returns the environment base URL, or NULL if unset.
   *
   * @return string|null
   *   The base URL, or NULL when not set.
   */
  public function getBaseUrl(): ?string;

  /**
   * Returns the deployment tier.
   *
   * @return string
   *   One of 'production', 'staging', 'development' or 'other'.
   */
  public function getTier(): string;

  /**
   * Returns the git branch whose CI deploy targets this environment.
   *
   * @return string|null
   *   The branch name (e.g. 'develop', 'main'), or NULL when unset.
   */
  public function getBranch(): ?string;

  /**
   * Returns the project this environment belongs to, or NULL if unset.
   *
   * @return \Drupal\bb_core\Entity\BbProjectInterface|null
   *   The owning project, or NULL when not set.
   */
  public function getProject(): ?BbProjectInterface;

}
