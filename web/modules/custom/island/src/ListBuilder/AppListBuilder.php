<?php

declare(strict_types=1);

namespace Drupal\island\ListBuilder;

use Drupal\Core\Config\Entity\ConfigEntityListBuilder;
use Drupal\Core\Entity\EntityInterface;
use Drupal\island\Entity\App;

/**
 * Lists island apps.
 */
final class AppListBuilder extends ConfigEntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return ['label' => $this->t('Label'), 'provider' => $this->t('Provider')] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof App);
    return ['label' => $entity->label(), 'provider' => $entity->getProviderId()] + parent::buildRow($entity);
  }

}
