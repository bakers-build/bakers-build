<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionBase;
use Drupal\bb_track\Access\WorklogFormAccess;

/**
 * Offers projects the actor may assign on a Worklog form.
 */
#[EntityReferenceSelection(
  id: 'bb_track_work_project',
  label: new TranslatableMarkup('Worklog projects'),
  entity_types: ['bb_project'],
  group: 'bb_track_work_project',
  weight: 0,
)]
final class WorkProjectSelection extends ActiveWorkspaceSelectionBase {

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS'): QueryInterface {
    $query = parent::buildEntityQuery($match, $match_operator);
    $project_ids = $this->readScope->projectIds($this->currentUser);
    $recordable = [];
    if ($project_ids !== []) {
      foreach ($this->entityTypeManager->getStorage('bb_project')->loadMultiple($project_ids) as $project) {
        if ($project instanceof BbProjectInterface
          && WorklogFormAccess::canRecordOnProject($this->currentUser, $project)) {
          $recordable[] = (int) $project->id();
        }
      }
    }
    if ($recordable === []) {
      $query->condition('id', 0);
      return $query;
    }
    $query->condition('id', $recordable, 'IN');
    return $query;
  }

}
