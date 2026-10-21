<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Offers only the groups of the active workspace.
 *
 * Narrowed rather than filled: which group is a real choice. Without an active
 * workspace the read scope already bounds the query. Core's ValidReference
 * runs this query on submit, so it is a write gate too and honours the
 * `administer bakers` bypass. The membership and ambient-match rules live in
 * BbWorkspaceScope, not here.
 *
 * @see \Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionBase
 */
#[EntityReferenceSelection(
  id: 'bb_group_in_active_workspace',
  label: new TranslatableMarkup('Groups of the active workspace'),
  entity_types: ['bb_group'],
  group: 'bb_group_in_active_workspace',
  weight: 0,
)]
class GroupInActiveWorkspaceSelection extends ActiveWorkspaceSelectionBase {

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS'): QueryInterface {
    $query = parent::buildEntityQuery($match, $match_operator);
    // The global escape hatch, asked as a permission on the TARGET type this
    // plugin queries — never read off the shape of a condition group.
    // ValidReference calls validateReferenceableEntities() to check a submitted
    // value, so skipping the condition here keeps that write open for an
    // `administer bakers` account, as BbWorkspaceScope does.
    if ($this->readScope->isBypassed($this->currentUser, 'bb_group')) {
      return $query;
    }
    $workspace_id = $this->activeWorkspaceId();
    if ($workspace_id !== NULL) {
      $query->condition('workspace_id', $workspace_id);
    }
    return $query;
  }

}
