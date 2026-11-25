<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Run\RunSummary;

/**
 * How often a ticket has run, as the reader may see its runs.
 *
 * Empty for a ticket without visible runs, so its row stays quiet; the
 * `bb_run_summary` formatter adds the newest run's state and time.
 */
final class RunSummaryItemList extends FieldItemList implements CacheableDependencyInterface {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if ($ticket->isNew()) {
      return;
    }
    $count = \Drupal::service('bb_core.ticket_run_summary')->forTicket($ticket->id())->count ?? 0;
    if ($count > 0) {
      $this->list[0] = $this->createItem(0, $count);
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    return RunSummary::CACHE['contexts'];
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheTags(): array {
    return RunSummary::CACHE['tags'];
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheMaxAge(): int {
    return -1;
  }

}
