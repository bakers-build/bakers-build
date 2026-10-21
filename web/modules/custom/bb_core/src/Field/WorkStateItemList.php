<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the board column classification for a ticket.
 */
final class WorkStateItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function ensureComputedValue(): void {
    $this->computeValue();
    $this->valueComputed = TRUE;
  }

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $entity = $this->getEntity();
    if (!$entity instanceof BbTicketInterface) {
      return;
    }
    $value = $entity->get('closed')->value ? 'done'
      : ($entity->get('conductor_id')->isEmpty() ? 'not_assigned'
        : ($entity->get('state')->value === 'qualification' ? 'intake' : 'working'));
    $this->list[0] = $this->createItem(0, $value);
  }

}
