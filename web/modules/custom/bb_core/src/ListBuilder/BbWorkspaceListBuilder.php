<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Provides the admin listing table for bakers.build workspace entities.
 *
 * Renders each workspace's human-readable label plus its slug — the handle
 * that appears in every product URL, and therefore the column an operator
 * needs when reading or writing one.
 */
final class BbWorkspaceListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'name' => $this->t('Name'),
      'slug' => $this->t('Slug'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    return [
      'name' => $entity->label(),
      'slug' => $entity instanceof BbWorkspaceInterface ? $entity->getSlug() : '',
    ] + parent::buildRow($entity);
  }

}
