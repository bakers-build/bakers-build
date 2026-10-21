<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Config\Entity\ConfigEntityListBuilder;
use Drupal\Core\Entity\EntityInterface;

/**
 * Lists titled statistics figure groups.
 */
final class BbFigureGroupListBuilder extends ConfigEntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'label' => $this->t('Label'),
      'figures' => $this->t('Figures'),
      'weight' => $this->t('Weight'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    /** @var \Drupal\bb_core\BbFigureGroupInterface $entity */
    return [
      'label' => $entity->label(),
      'figures' => implode(', ', $entity->getFigures()),
      'weight' => $entity->getWeight(),
    ] + parent::buildRow($entity);
  }

}
