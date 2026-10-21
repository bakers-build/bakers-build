<?php

declare(strict_types=1);

namespace Drupal\island\ListBuilder;

use Drupal\Core\Config\Entity\ConfigEntityListBuilder;
use Drupal\Core\Entity\EntityInterface;
use Drupal\island\Entity\IslandProfile;

/**
 * Lists island profiles.
 */
final class IslandProfileListBuilder extends ConfigEntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return ['label' => $this->t('Label'), 'app' => $this->t('App'), 'layout' => $this->t('Layout')] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof IslandProfile);
    return [
      'label' => $entity->label(),
      'app' => $entity->getAppId(),
      'layout' => $entity->getLayoutId(),
    ] + parent::buildRow($entity);
  }

}
