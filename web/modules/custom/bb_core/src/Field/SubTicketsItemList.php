<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\EntityReferenceFieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the direct sub-tickets of a ticket.
 *
 * Reflects every bb_ticket whose parent_id references this ticket, ordered
 * by priority ASC, then created ASC. Read-only: parent_id remains the single
 * source of truth
 * (mirrors CommentsItemList). Used by the ticket_detail full view's
 * `sub_tickets` slot.
 */
final class SubTicketsItemList extends EntityReferenceFieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew()) {
      return;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_ticket');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('parent_id', $ticket->id())
      ->sort('priority', 'ASC')
      ->sort('created', 'ASC')
      ->sort('id', 'ASC')
      ->execute();
    $delta = 0;
    foreach ($ids as $id) {
      $this->list[$delta] = $this->createItem($delta, ['target_id' => $id]);
      $delta++;
    }
  }

}
