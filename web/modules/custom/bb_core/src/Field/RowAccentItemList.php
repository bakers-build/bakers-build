<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicket;

/**
 * A ticket row's status rail: occupancy, not phase.
 *
 * `attention` while the workflow is in review, else `running` while a
 * conductor holds the ticket; review wins even with a conductor. Empty
 * otherwise, so the row has no rail.
 */
final class RowAccentItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicket) {
      return;
    }
    $accent = $ticket->getBbPhase() === 'review' ? 'attention' : ($ticket->hasBbConductor() ? 'running' : '');
    if ($accent !== '') {
      $this->list[0] = $this->createItem(0, $accent);
    }
  }

}
