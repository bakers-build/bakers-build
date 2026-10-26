<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\FieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use Drupal\state_machine\Plugin\Workflow\WorkflowInterface;

/**
 * Computes the ordered workflow states of a state_machine entity.
 *
 * Reads the entity's `state` field workflow (resolved per entity via the
 * field's workflow / workflow_callback setting — bb_ticket picks bb_work,
 * bb_run is fixed to bb_run) and emits its
 * states in definition order, minus the terminal `cancelled` side-exit,
 * comma-joined. This keeps every state-flow presentation (ticket_detail,
 * run_row) sourced from bb_core.workflows.yml instead of a hard-coded list.
 * Rides a single scalar prop: computed fields expose no field_property source,
 * so the display binds this via a string field formatter and the template
 * splits it back into the ordered list.
 */
final class StateFlowItemList extends FieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $entity = $this->getEntity();
    if (!$entity->hasField('state')) {
      return;
    }
    $item = $entity->get('state')->first();
    if (!$item instanceof StateItemInterface) {
      return;
    }
    $workflow = $item->getWorkflow();
    if (!$workflow instanceof WorkflowInterface) {
      return;
    }
    $states = [];
    foreach (array_keys($workflow->getStates()) as $id) {
      if ($id === 'cancelled') {
        continue;
      }
      $states[] = $id;
    }
    $this->list[0] = $this->createItem(0, implode(',', $states));
  }

}
