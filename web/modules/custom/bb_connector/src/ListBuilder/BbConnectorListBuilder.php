<?php

declare(strict_types=1);

namespace Drupal\bb_connector\ListBuilder;

use Drupal\Core\Config\Entity\ConfigEntityListBuilder;
use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_core\Time\BbDate;

/**
 * Lists bb_connector config entities.
 */
final class BbConnectorListBuilder extends ConfigEntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'label' => $this->t('Label'),
      'plugin' => $this->t('System'),
      'base_url' => $this->t('Base URL'),
      'import_interval' => $this->t('Cron interval'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    /** @var \Drupal\bb_connector\Entity\BbConnectorInterface $entity */
    return [
      'label' => $entity->label(),
      'plugin' => $entity->getPluginId(),
      'base_url' => (string) $entity->getSetting('base_url'),
      'import_interval' => $entity->getImportInterval() > 0 ? \Drupal::service(BbDate::class)->duration($entity->getImportInterval()) : $this->t('disabled'),
    ] + parent::buildRow($entity);
  }

}
