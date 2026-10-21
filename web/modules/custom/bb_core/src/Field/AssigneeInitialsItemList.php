<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the assignee initials for a ticket.
 */
final class AssigneeInitialsItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface) {
      return;
    }
    $value = \Drupal::service('bb_core.ticket_run_deriver')->assignee($ticket)['initials'];
    $this->list[0] = $this->createItem(0, $value);
  }

}
