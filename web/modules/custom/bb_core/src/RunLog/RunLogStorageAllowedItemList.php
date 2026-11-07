<?php

declare(strict_types=1);

namespace Drupal\bb_core\RunLog;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;

/**
 * Computes bb_run.run_log_storage_allowed from the current policy.
 *
 * The conductor reads it when it finalizes a run; the server checks the
 * policy again when the transcript arrives.
 */
final class RunLogStorageAllowedItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $this->list[0] = $this->createItem(0, \Drupal::service(RunLogPolicy::class)->allowsStorage($this->getEntity()));
  }

}
