<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\Query\QueryInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Offers only the groups or teams of the referring row's workspace.
 *
 * The workspace is the saved row's, else the active one on create. The saved
 * row is read unchanged because a project's group is what places it: the
 * edited value would otherwise vouch for itself. Without either workspace the
 * read scope already bounds the query. Core's ValidReference runs this query
 * on submit, so it is a write gate too and honours the `administer bakers`
 * bypass. The membership and ambient-match rules live in BbWorkspaceScope.
 *
 * @see \Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionBase
 */
#[EntityReferenceSelection(
  id: 'bb_in_entity_workspace',
  label: new TranslatableMarkup("Entries of the referring row's workspace"),
  entity_types: ['bb_group', 'bb_team'],
  group: 'bb_in_entity_workspace',
  weight: 0,
)]
class InEntityWorkspaceSelection extends ActiveWorkspaceSelectionBase {

  /**
   * The row-to-workspace chain walker.
   */
  protected WorkspaceResolverInterface $workspaceResolver;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->workspaceResolver = $container->get('bb_core.workspace_resolver');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS'): QueryInterface {
    $query = parent::buildEntityQuery($match, $match_operator);
    // Asked as a permission on the TARGET type, as BbWorkspaceScope does.
    if ($this->readScope->isBypassed($this->currentUser, $this->configuration['target_type'])) {
      return $query;
    }
    $workspace_id = $this->targetWorkspaceId();
    if ($workspace_id !== NULL) {
      $query->condition('workspace_id', $workspace_id);
    }
    return $query;
  }

  /**
   * The saved row's workspace, else the active one, or NULL.
   */
  private function targetWorkspaceId(): ?int {
    $entity = $this->configuration['entity'] ?? NULL;
    if ($entity instanceof EntityInterface && !$entity->isNew()) {
      $stored = $this->entityTypeManager->getStorage($entity->getEntityTypeId())->loadUnchanged($entity->id());
      $workspace = $stored === NULL ? NULL : $this->workspaceResolver->resolve($stored);
      if ($workspace !== NULL) {
        return (int) $workspace->id();
      }
    }
    return $this->activeWorkspaceId();
  }

}
