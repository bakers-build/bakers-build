<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbConductorInterface;

/**
 * Computes a conductor's effective assignment, e.g. "allow (machine)".
 */
final class ConductorAssignmentEffectiveItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $conductor = $this->getEntity();
    if (!$conductor instanceof BbConductorInterface) {
      return;
    }
    $effective = $conductor->getEffectiveAssignment();
    $this->list[0] = $this->createItem(0, $effective['value'] . ' (' . $effective['source'] . ')');
  }

}
