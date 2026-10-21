<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * Computes the humanised last-seen label for a conductor node.
 */
final class LastSeenLabelItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $conductor = $this->getEntity();
    if (!$conductor instanceof BbConductorInterface) {
      return;
    }
    $value = \Drupal::service('bb_core.conductor_deriver')
      ->lastSeenLabel($conductor);
    $this->list[0] = $this->createItem(0, $value);
  }

}
