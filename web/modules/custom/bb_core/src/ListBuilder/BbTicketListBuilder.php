<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Provides a list builder for bakers.build ticket entities.
 *
 * Renders the administration overview table showing each ticket's identifier,
 * title, workflow and current state.
 */
final class BbTicketListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return [
      'identifier' => $this->t('Identifier'),
      'title' => $this->t('Title'),
      'workflow' => $this->t('Workflow'),
      'state' => $this->t('State'),
    ] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof BbTicketInterface);
    return [
      'identifier' => $entity->getIdentifier(),
      'title' => $entity->label(),
      'workflow' => $entity->getWorkflow(),
      'state' => $entity->get('state')->value,
    ] + parent::buildRow($entity);
  }

}
