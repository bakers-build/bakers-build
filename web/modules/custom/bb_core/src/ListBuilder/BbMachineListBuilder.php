<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\bb_core\Entity\BbMachineInterface;

/**
 * Provides the admin listing table for bakers.build machine entities.
 */
final class BbMachineListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'name' => $this->t('Name'),
      'host_key' => $this->t('Host key'),
      'load' => $this->t('Load'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof BbMachineInterface);
    return [
      'name' => $entity->label(),
      'host_key' => $entity->getHostKey(),
      'load' => $entity->getCurrentLoad() . ' / ' . $entity->getMaxParallel(),
    ] + parent::buildRow($entity);
  }

}
