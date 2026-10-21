<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Access\WorkspaceResolverInterface;
use Drupal\user\Plugin\EntityReferenceSelection\UserSelection;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Offers only the accounts of the referring row's workspace.
 *
 * Extends `UserSelection` to keep its anonymous, blocked and role filters. The
 * workspace is the referring row's (via WorkspaceResolverInterface), else the
 * active one; with neither, the user read scope already bounds the query. Also
 * a write gate through ValidReference, so it honours the `administer users`
 * bypass (`administer bakers` cannot read foreign accounts anyway).
 *
 * @see \Drupal\bb_core\Plugin\EntityReferenceSelection\ActiveWorkspaceSelectionTrait
 */
#[EntityReferenceSelection(
  id: 'bb_assignee_in_ticket_workspace',
  label: new TranslatableMarkup("Accounts of the referring row's workspace"),
  entity_types: ['user'],
  group: 'bb_assignee_in_ticket_workspace',
  weight: 0,
)]
class AssigneeInTicketWorkspaceSelection extends UserSelection {

  use ActiveWorkspaceSelectionTrait;

  /**
   * The row-to-workspace chain walker.
   *
   * @var \Drupal\bb_core\Access\WorkspaceResolverInterface
   */
  protected WorkspaceResolverInterface $workspaceResolver;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->initActiveWorkspaceServices($container);
    $instance->workspaceResolver = $container->get('bb_core.workspace_resolver');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS') {
    $query = parent::buildEntityQuery($match, $match_operator);
    // The escape hatch, asked as a permission on the TARGET type this plugin
    // queries — never read off the shape of a condition group. ValidReference
    // calls validateReferenceableEntities() to check a submitted value, so
    // skipping the condition here is what keeps that write open for an account
    // that administers users.
    if ($this->readScope->isBypassed($this->currentUser, 'user')) {
      return $query;
    }
    $workspace_id = $this->targetWorkspaceId();
    if ($workspace_id === NULL) {
      return $query;
    }
    $uids = $this->memberIdsOfWorkspace($workspace_id);
    // A workspace with no member must offer NOBODY, not everybody — and the
    // sentinel is -1 rather than the 0 the bakers-type plugins use, because 0 is
    // the anonymous account and `UserSelection` keeps it in the query unless
    // `include_anonymous` is switched off.
    $query->condition('uid', $uids === [] ? [-1] : $uids, 'IN');
    return $query;
  }

  /**
   * The workspace whose accounts may be offered, or NULL when there is none.
   *
   * @return int|null
   *   The bb_workspace entity id.
   */
  private function targetWorkspaceId(): ?int {
    $entity = $this->configuration['entity'] ?? NULL;
    if ($entity instanceof EntityInterface) {
      $workspace = $this->workspaceResolver->resolve($entity);
      if ($workspace !== NULL) {
        return (int) $workspace->id();
      }
    }
    return $this->activeWorkspaceId();
  }

}
