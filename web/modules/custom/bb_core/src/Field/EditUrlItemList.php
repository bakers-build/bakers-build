<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the ticket edit-form URL, gated on update access.
 *
 * Yields the ticket's edit-form URL only when the current user may update the
 * ticket; otherwise the field stays empty so the detail SDC hides the Edit
 * link. The edit_form route is itself access-guarded, so this is
 * defence-in-depth, not the sole gate.
 */
final class EditUrlItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew()) {
      return;
    }
    if (!$ticket->access('update')) {
      return;
    }
    $this->list[0] = $this->createItem(0, $ticket->toUrl('edit-form')->toString());
  }

}
