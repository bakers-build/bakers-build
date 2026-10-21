<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Context;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Plugin\Context\Context;
use Drupal\Core\Plugin\Context\EntityContextDefinition;

/**
 * Adapts named route entities into Drupal runtime contexts.
 */
final class FigureContextRepository {

  /**
   * Converts named entities to Drupal plugin contexts.
   *
   * @param array<string, EntityInterface> $entities
   *   The named entities.
   *
   * @return array<string, \Drupal\Core\Plugin\Context\ContextInterface>
   *   The contexts keyed by route context name.
   */
  public function fromEntities(array $entities): array {
    $contexts = [];
    foreach ($entities as $key => $entity) {
      if (!$entity instanceof EntityInterface) {
        throw new \InvalidArgumentException(sprintf('Figure context "%s" is not an entity.', $key));
      }
      $definition = new EntityContextDefinition(
        data_type: 'entity:' . $entity->getEntityTypeId(),
        label: $entity->getEntityType()->getLabel(),
      );
      $contexts[$key] = new Context($definition, $entity);
    }
    return $contexts;
  }

}
