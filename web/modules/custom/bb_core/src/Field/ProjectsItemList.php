<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\EntityReferenceFieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTeamInterface;

/**
 * Computes the projects assigned to a team.
 *
 * Reflects every bb_project whose `teams` list references this team, ordered
 * by name ASC. Read-only: `bb_project.teams` remains the single source of
 * truth; a stored inverse would drift from it.
 *
 * Modelled on EnvironmentsItemList, deliberately: the only difference between
 * the two is that the stored side here is multi-value, which changes nothing
 * about the query — an entity query condition on a multi-value reference field
 * matches any delta.
 */
final class ProjectsItemList extends EntityReferenceFieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $team = $this->getEntity();
    if (!$team instanceof BbTeamInterface || $team->isNew()) {
      return;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_project');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('teams', $team->id())
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
