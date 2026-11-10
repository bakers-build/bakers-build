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
 * Offers only the terms of the referring row's workspace.
 *
 * The workspace is the referring row's, else the active one on create; with
 * neither, the read scope bounds the offer. Read scope alone offers every
 * workspace the account belongs to; the BbTicketLabelWorkspace constraint
 * still guards the write.
 */
#[EntityReferenceSelection(
  id: 'bb_label_in_entity_workspace',
  label: new TranslatableMarkup("Terms of the referring row's workspace"),
  entity_types: ['bb_term'],
  group: 'bb_label_in_entity_workspace',
  weight: 0,
)]
class LabelInEntityWorkspaceSelection extends ActiveWorkspaceSelectionBase {

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
    $entity = $this->configuration['entity'] ?? NULL;
    $workspace_id = $entity instanceof EntityInterface ? $this->workspaceResolver->resolve($entity)?->id() : NULL;
    $workspace_id ??= $this->activeWorkspaceId();
    // With neither, the read scope already bounds the query.
    if ($workspace_id !== NULL) {
      $query->condition('workspace_id', $workspace_id);
    }
    return $query;
  }

}
