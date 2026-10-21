<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;

/**
 * Provides the admin listing table for bakers.build groups and teams.
 *
 * Renders each entity's label as the sole data column.
 */
final class BbLabelListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return ['name' => $this->t('Name')] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    return ['name' => $entity->label()] + parent::buildRow($entity);
  }

}
