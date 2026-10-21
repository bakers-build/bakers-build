<?php

declare(strict_types=1);

namespace Drupal\bb_core\ListBuilder;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\bb_core\Entity\BbCommentInterface;

/**
 * Provides the admin listing table for bakers.build comment entities.
 *
 * Displays each comment's internal ID and the ticket it belongs to.
 */
final class BbCommentListBuilder extends EntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    return ['id' => $this->t('ID'), 'ticket' => $this->t('Ticket')] + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    assert($entity instanceof BbCommentInterface);
    return [
      'id' => $entity->id(),
      'ticket' => $entity->getTicketId(),
    ] + parent::buildRow($entity);
  }

}
