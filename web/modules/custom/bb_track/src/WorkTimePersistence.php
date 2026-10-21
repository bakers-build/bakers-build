<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Entity\EntityInterface;

/**
 * Private persistence capability, available only inside checked operations.
 */
trait WorkTimePersistence {

  /**
   * Exact entity authorized by the active operation.
   */
  private ?EntityInterface $persisting = NULL;

  /**
   * Read-only storage capability; no caller can grant itself write authority.
   */
  public function mayPersist(EntityInterface $entity): bool {
    return $this->persisting === $entity;
  }

  /**
   * Grants authority only around this exact save, and always revokes it.
   */
  private function persist(EntityInterface $entity): void {
    $this->persisting = $entity;
    try {
      $entity->save();
    }
    finally {
      $this->persisting = NULL;
    }
  }

}
