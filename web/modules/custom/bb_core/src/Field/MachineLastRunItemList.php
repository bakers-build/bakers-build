<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Cache\CacheableDependencyInterface;
use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;

/**
 * A machine's last run: the latest heartbeat of its conductors.
 *
 * Empty while no conductor on the machine has reported.
 */
final class MachineLastRunItemList extends FieldItemList implements CacheableDependencyInterface {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $machine = $this->getEntity();
    if ($machine->isNew()) {
      return;
    }
    // The heartbeat is a fact about the machine the reader already sees; the
    // conductors behind it are not listed.
    $result = \Drupal::entityTypeManager()->getStorage('bb_conductor')
      ->getAggregateQuery()
      ->accessCheck(FALSE)
      ->condition('machine', $machine->id())
      ->condition('last_seen', 0, '>')
      ->aggregate('last_seen', 'MAX')
      ->execute();
    $latest = (int) ($result[0]['last_seen_max'] ?? 0);
    if ($latest > 0) {
      $this->list[0] = $this->createItem(0, $latest);
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheTags(): array {
    // Any conductor heartbeat may be the newest.
    return ['bb_conductor_list'];
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheMaxAge(): int {
    return -1;
  }

}
