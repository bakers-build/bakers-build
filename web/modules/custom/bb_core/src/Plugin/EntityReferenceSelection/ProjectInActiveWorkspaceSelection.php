<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Offers only the projects of the active workspace.
 *
 * The workspace's groups are resolved to IDS first and matched with a
 * single-level `IN` rather than traversing `group_id.entity.workspace_id`.
 *
 * Without an active workspace the query is left as DefaultSelection built it;
 * see GroupInActiveWorkspaceSelection for why that fall-open is safe, for why
 * the `administer bakers` bypass below is a write gate rather than merely an
 * offer, and for why the membership and ambient-match rules are deliberately
 * not here.
 *
 * @see \Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionBase
 */
#[EntityReferenceSelection(
  id: 'bb_project_in_active_workspace',
  label: new TranslatableMarkup('Projects of the active workspace'),
  entity_types: ['bb_project'],
  group: 'bb_project_in_active_workspace',
  weight: 0,
)]
class ProjectInActiveWorkspaceSelection extends ActiveWorkspaceSelectionBase {

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
    if ($this->readScope->isBypassed($this->currentUser, 'bb_project')) {
      return $query;
    }
    $workspace_id = $this->activeWorkspaceId();
    if ($workspace_id === NULL) {
      return $query;
    }
    // accessCheck(FALSE) is deliberate and safe: this inner query answers the
    // structural question "which groups belong to this workspace", while the
    // outer query keeps its access check and therefore its read-scope bound.
    $group_ids = $this->entityTypeManager->getStorage('bb_group')->getQuery()
      ->accessCheck(FALSE)
      ->condition('workspace_id', $workspace_id)
      ->execute();
    // A workspace with no group must offer nothing, not everything.
    $query->condition('group_id', $group_ids === [] ? [0] : $group_ids, 'IN');
    return $query;
  }

}
