<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * Provides the admin listing table for bakers.build conductor entities.
 *
 * Displays each conductor's registration key and current operational status.
 */
final class BbConductorListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'conductor_id' => $this->t('Conductor ID'),
      'status' => $this->t('Status'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof BbConductorInterface);
    return [
      'conductor_id' => $entity->getConductorId(),
      'status' => $entity->getStatus(),
    ] + parent::buildRow($entity);
  }

}
