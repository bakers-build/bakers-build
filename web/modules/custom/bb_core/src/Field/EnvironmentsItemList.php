<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\EntityReferenceFieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbProjectInterface;

/**
 * Computes the environments belonging to a project.
 *
 * Reflects every bb_environment whose project_id references this project,
 * ordered by name ASC. Read-only: project_id remains the single source of
 * truth. Environments are provisioned programmatically, not through the project
 * form, so this list is a view rather than an editable field.
 */
final class EnvironmentsItemList extends EntityReferenceFieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $project = $this->getEntity();
    if (!$project instanceof BbProjectInterface || $project->isNew()) {
      return;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_environment');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('project_id', $project->id())
      ->sort('name', 'ASC')
      ->sort('id', 'ASC')
      ->execute();
    $delta = 0;
    foreach ($ids as $id) {
      $this->list[$delta] = $this->createItem($delta, ['target_id' => $id]);
      $delta++;
    }
  }

}
