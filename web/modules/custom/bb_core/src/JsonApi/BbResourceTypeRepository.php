<?php

declare(strict_types=1);

namespace Drupal\bb_core\JsonApi;

use Drupal\Core\Entity\ContentEntityTypeInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\jsonapi\ResourceType\ResourceTypeRepository;

/**
 * Emits counting resource types for bakers.build's own content entity types.
 *
 * Selection is by entity type ID prefix and content-entity-ness rather than by
 * an enumerated list of resource types: a list would be a second source of
 * truth that goes stale the first time a new bakers.build entity gets a list screen.
 * Everything else — user, file, the bb_vocabulary config
 * entity — keeps core's FALSE and pays nothing.
 */
final class BbResourceTypeRepository extends ResourceTypeRepository {

  /**
   * {@inheritdoc}
   */
  protected function createResourceType(EntityTypeInterface $entity_type, $bundle) {
    $resource_type = parent::createResourceType($entity_type, $bundle);
    if (!$this->countsCollections($entity_type)) {
      return $resource_type;
    }
    return new BbResourceType(
      $resource_type->getEntityTypeId(),
      $resource_type->getBundle(),
      $resource_type->getDeserializationTargetClass(),
      $resource_type->isInternal(),
      $resource_type->isLocatable(),
      $resource_type->isMutable(),
      $resource_type->isVersionable(),
      $resource_type->getFields(),
      $resource_type->getTypeName(),
    );
  }

  /**
   * Whether collections of this entity type should report a total.
   *
   * @param \Drupal\Core\Entity\EntityTypeInterface $entity_type
   *   The entity type behind the resource type.
   *
   * @return bool
   *   TRUE for bakers.build's own content entity types.
   */
  private function countsCollections(EntityTypeInterface $entity_type): bool {
    return $entity_type instanceof ContentEntityTypeInterface
      && str_starts_with((string) $entity_type->id(), 'bb_');
  }

}
