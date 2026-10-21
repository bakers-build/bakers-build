<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\EntityReferenceSelection;

use Drupal\Core\Entity\Attribute\EntityReferenceSelection;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\user\Plugin\EntityReferenceSelection\UserSelection;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Offers only the accounts that already belong to one workspace.
 *
 * The Members add field used core's `UserSelection` and enumerated every
 * account on the instance. Adding someone to a team (or any nested group)
 * must pick from the parent workspace's crew — a person who is not in the
 * workspace cannot join one of its teams.
 *
 * IT EXTENDS `UserSelection` for the same reason the assignee handler
 * does: anonymous, blocked and role filters stay. The workspace id comes from
 * `#selection_settings` (the form) so the autocomplete request, which has no
 * `{bb_workspace}`, still narrows. No workspace id means nobody, not
 * everybody.
 */
#[EntityReferenceSelection(
  id: 'bb_workspace_members',
  label: new TranslatableMarkup('Accounts of one workspace'),
  entity_types: ['user'],
  group: 'bb_workspace_members',
  weight: 0,
)]
final class WorkspaceMembersSelection extends UserSelection {

  use ActiveWorkspaceSelectionTrait;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->initActiveWorkspaceServices($container);
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  protected function buildEntityQuery($match = NULL, $match_operator = 'CONTAINS') {
    $query = parent::buildEntityQuery($match, $match_operator);
    $workspace_id = $this->activeWorkspaceId();
    if ($workspace_id === NULL) {
      $query->condition('uid', [-1], 'IN');
      return $query;
    }
    $uids = $this->memberIdsOfWorkspace($workspace_id);
    $query->condition('uid', $uids === [] ? [-1] : $uids, 'IN');
    return $query;
  }

}
