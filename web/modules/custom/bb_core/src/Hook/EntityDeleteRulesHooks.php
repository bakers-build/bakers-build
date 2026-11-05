<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Entity\EntityDeleteRules;

/**
 * Applies the delete rules to every entity delete, also programmatic ones.
 */
final class EntityDeleteRulesHooks {

  public function __construct(
    private readonly EntityDeleteRules $rules,
  ) {}

  /**
   * Blocks, cascades and detaches before the entity is deleted.
   */
  #[Hook('entity_predelete')]
  public function entityPredelete(EntityInterface $entity): void {
    $this->rules->apply($entity);
  }

}
