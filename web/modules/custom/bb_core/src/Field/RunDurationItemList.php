<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbRunInterface;

/**
 * Computes the compact humanised duration of a run ("1m 12s").
 *
 * Duration is closed_date − started_at, derived live from the raw bb_run
 * timings (no schema change). Empty for a run that has not finished. Rides a
 * single scalar prop the run_row display binds via a string field formatter.
 */
final class RunDurationItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $run = $this->getEntity();
    if (!$run instanceof BbRunInterface) {
      return;
    }
    $value = \Drupal::service('bb_core.ticket_run_deriver')->runDurationLabel($run);
    if ($value !== '') {
      $this->list[0] = $this->createItem(0, $value);
    }
  }

}
