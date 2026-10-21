<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Config\Entity\ConfigEntityListBuilder;
use Drupal\Core\Entity\EntityInterface;

/**
 * Lists reusable statistics measurements.
 */
final class BbMeasurementListBuilder extends ConfigEntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'label' => $this->t('Label'),
      'operation' => $this->t('Operation'),
      'unit' => $this->t('Unit'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    /** @var \Drupal\bb_core\BbMeasurementInterface $entity */
    return [
      'label' => $entity->label(),
      'operation' => $entity->getOperation()['type'] ?? '',
      'unit' => $entity->getUnit(),
    ] + parent::buildRow($entity);
  }

}
