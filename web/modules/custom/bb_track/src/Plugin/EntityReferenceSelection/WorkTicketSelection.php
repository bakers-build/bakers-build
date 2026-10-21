<?php

declare(strict_types=1);

namespace Drupal\bb_track\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionBase;

/**
 * Offers tickets of the selected project on a Worklog form.
 */
#[EntityReferenceSelection(
  id: 'bb_track_work_ticket',
  label: new TranslatableMarkup('Worklog tickets'),
  entity_types: ['bb_ticket'],
  group: 'bb_track_work_ticket',
  weight: 0,
)]
final class WorkTicketSelection extends ActiveWorkspaceSelectionBase {

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS'): QueryInterface {
    $query = parent::buildEntityQuery($match, $match_operator);
    $project_id = $this->configuration['bb_selected_project'] ?? NULL;
    if (!is_numeric($project_id) || (int) $project_id === 0) {
      $query->condition('id', 0);
      return $query;
    }
    $project_id = (int) $project_id;
    $allowed = $this->readScope->projectIds($this->currentUser);
    if (!in_array($project_id, $allowed, TRUE)) {
      $query->condition('id', 0);
      return $query;
    }
    $query->condition('project_id', $project_id);
    return $query;
  }

}
