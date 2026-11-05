<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\EntityReferenceFieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the deployment tickets that carry a ticket.
 *
 * Reflects every bb_ticket of type `deployment` whose referenced_tickets
 * contain this ticket, ordered by created ASC, then id ASC. Read-only: the
 * deployment's referenced_tickets is the single record of where a ticket is
 * deployed. The query is access-checked, the read boundary the ticket tools
 * use, so a deployment the current user may not read is left out.
 */
final class DeploymentsItemList extends EntityReferenceFieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew()) {
      return;
    }
    $ids = \Drupal::entityTypeManager()->getStorage('bb_ticket')->getQuery()
      ->accessCheck(TRUE)
      ->condition('referenced_tickets', $ticket->id())
      ->condition('ticket_type.entity.name', 'deployment')
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
