<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\Display\EntityFormDisplayInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Plugin\Field\FieldWidget\PickerWidget;

/**
 * Rejects ticket relations outside the pickers' own candidates.
 *
 * Shared by the ticket forms that place Parent and Blocked by pickers. The
 * error never names the rejected ticket: its label may be private.
 */
trait ProjectScopedRelationsTrait {

  /**
   * Sets a field error for each relation picker with a rejected new value.
   *
   * @param \Drupal\Core\Entity\Display\EntityFormDisplayInterface $display
   *   The form display holding the pickers.
   * @param \Drupal\Core\Entity\ContentEntityInterface $entity
   *   The entity built from the submission.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   * @param \Drupal\Core\Entity\ContentEntityInterface|null $stored
   *   The stored entity; its existing relations are kept unchecked.
   */
  protected function rejectProjectScopedRelations(EntityFormDisplayInterface $display, ContentEntityInterface $entity, FormStateInterface $form_state, ?ContentEntityInterface $stored = NULL): void {
    foreach (['parent_id', 'blocked_by'] as $name) {
      $widget = $display->getComponent($name) !== NULL ? $display->getRenderer($name) : NULL;
      if (!$widget instanceof PickerWidget || !$entity->hasField($name)) {
        continue;
      }
      $kept = $stored !== NULL ? array_column($stored->get($name)->getValue(), 'target_id') : [];
      if ($widget->rejectedValues($entity->get($name), $kept) !== []) {
        $form_state->setErrorByName($name, $name === 'parent_id'
          ? $this->t("Choose an open parent ticket from this ticket's project.")
          : $this->t("Choose open blocking tickets from this ticket's project."));
      }
    }
  }

}
