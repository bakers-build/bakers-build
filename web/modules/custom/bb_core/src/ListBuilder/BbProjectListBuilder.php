<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\bb_core\Entity\BbProjectInterface;

/**
 * Provides the admin listing table for bakers.build project entities.
 *
 * Shows each project's name alongside the group it belongs to.
 */
final class BbProjectListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return ['name' => $this->t('Name'), 'group' => $this->t('Group')] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof BbProjectInterface);
    return [
      'name' => $entity->label(),
      'group' => $entity->getGroup()?->label() ?? '',
    ] + parent::buildRow($entity);
  }

}
