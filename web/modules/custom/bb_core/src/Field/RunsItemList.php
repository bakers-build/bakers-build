<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\EntityReferenceFieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the conductor runs belonging to a ticket.
 *
 * Reflects every bb_run whose ticket_id references this ticket, most recent
 * first (created DESC). Read-only: ticket_id remains the single source of
 * truth (mirrors CommentsItemList). Used by the ticket_detail full view's
 * `runs` slot.
 */
final class RunsItemList extends EntityReferenceFieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew()) {
      return;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_run');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->execute();
    $delta = 0;
    foreach ($ids as $id) {
      $this->list[$delta] = $this->createItem($delta, ['target_id' => $id]);
      $delta++;
    }
  }

}
