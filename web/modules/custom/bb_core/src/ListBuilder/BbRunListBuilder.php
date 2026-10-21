<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\bb_core\Entity\BbRunInterface;

/**
 * Provides the admin listing table for bakers.build run entities.
 *
 * Displays each run's internal ID and its current state (e.g. queued,
 * running, done) so operators can monitor conductor activity at a glance.
 */
final class BbRunListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return ['id' => $this->t('ID'), 'state' => $this->t('State')] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof BbRunInterface);
    return [
      'id' => $entity->id(),
      'state' => $entity->getRunState(),
    ] + parent::buildRow($entity);
  }

}
