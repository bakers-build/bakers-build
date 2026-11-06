<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Url;
use Drupal\bb_core\Form\BbConfigEntityDeleteForm;
use Drupal\bb_core\Form\OverlayTrigger;

/**
 * Every Delete opens its confirm form as the dialog over the current page.
 */
final class DeleteDialogHooks {

  /**
   * Gives island's own config entities the dialog-capable delete form.
   *
   * Island stays generic and cannot know bb_core's form.
   *
   * @param array<string, \Drupal\Core\Entity\EntityTypeInterface> $entity_types
   *   Entity type definitions, keyed by entity type id.
   */
  #[Hook('entity_type_alter')]
  public function entityTypeAlter(array &$entity_types): void {
    foreach (['island_app', 'island_profile'] as $entity_type_id) {
      ($entity_types[$entity_type_id] ?? NULL)?->setFormClass('delete', BbConfigEntityDeleteForm::class);
    }
  }

  /**
   * Opens a list's Delete operation in the overlay, not core's modal.
   *
   * @param array<string, array<string, mixed>> $operations
   *   The entity's operations, altered in place.
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity the operations belong to.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('entity_operation_alter')]
  public function entityOperationAlter(array &$operations, EntityInterface $entity): void {
    $url = $operations['delete']['url'] ?? NULL;
    if (!$url instanceof Url) {
      return;
    }
    $operations['delete']['attributes'] = OverlayTrigger::attributes($url);
  }

}
