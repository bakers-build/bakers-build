<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityChangedInterface;

/**
 * Defines the common interface shared by all bakers.build content entities.
 *
 * Extends the core content-entity and entity-changed contracts to guarantee
 * that every bakers.build entity exposes creation-time accessors alongside the
 * standard changed-time tracking.
 */
interface BbContentEntityInterface extends ContentEntityInterface, EntityChangedInterface {

  /**
   * Returns the Unix timestamp at which this entity was created.
   *
   * @return int
   *   The creation timestamp.
   */
  public function getCreatedTime(): int;

  /**
   * Sets the creation timestamp of this entity.
   *
   * @param int $timestamp
   *   Unix timestamp to store as the creation time.
   *
   * @return static
   */
  public function setCreatedTime(int $timestamp): static;

}
