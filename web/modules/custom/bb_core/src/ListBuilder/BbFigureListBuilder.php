<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Config\Entity\ConfigEntityListBuilder;
use Drupal\Core\Entity\EntityInterface;

/**
 * Lists atomic statistics figures.
 */
final class BbFigureListBuilder extends ConfigEntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'label' => $this->t('Label'),
      'widget' => $this->t('Widget'),
      'measurements' => $this->t('Measurements'),
      'contexts' => $this->t('Contexts'),
      'weight' => $this->t('Weight'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    /** @var \Drupal\bb_core\BbFigureInterface $entity */
    return [
      'label' => $entity->label(),
      'widget' => $entity->getWidget(),
      'measurements' => implode(', ', $entity->getMeasurements()),
      'contexts' => implode(', ', $entity->getContextShape()),
      'weight' => $entity->getWeight(),
    ] + parent::buildRow($entity);
  }

}
