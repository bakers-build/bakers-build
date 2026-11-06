<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Url;
use Drupal\bb_core\Form\DeleteDialogFormTrait;
use Drupal\bb_core\Form\OverlayTrigger;

/**
 * A Delete whose form speaks the dialog opens it over the current page.
 */
final class DeleteDialogHooks {

  /**
   * Opens a list's Delete operation in the overlay, not core's modal.
   *
   * Only delete forms using DeleteDialogFormTrait answer the dialog; every
   * other entity type keeps its operation as it is.
   *
   * @param array<string, array<string, mixed>> $operations
   *   The entity's operations, altered in place.
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity the operations belong to.
   */
  #[Hook('entity_operation_alter')]
  public function entityOperationAlter(array &$operations, EntityInterface $entity): void {
    $url = $operations['delete']['url'] ?? NULL;
    $form = $entity->getEntityType()->getFormClass('delete');
    if (!$url instanceof Url || !$form || !in_array(DeleteDialogFormTrait::class, class_uses($form) ?: [], TRUE)) {
      return;
    }
    $operations['delete']['attributes'] = OverlayTrigger::attributes($url);
  }

}
