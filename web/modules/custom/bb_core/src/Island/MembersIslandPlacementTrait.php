<?php

declare(strict_types=1);

namespace Drupal\bb_core\Island;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Form\GroupMembersForm;
use Drupal\bb_core\Members\MembersDialogResponse;
use Drupal\user\UserInterface;

/**
 * Places the shared `members` surface on a host's `configured_form` island.
 *
 * The type-blind half shared by the team and workspace hosts: the placement
 * id, the generic plugin and its configuration. Each host still implements
 * `getIslandData()`, the one place per-type data enters.
 */
trait MembersIslandPlacementTrait {

  /**
   * {@inheritdoc}
   */
  public function getIslandIds(): array {
    return ['members'];
  }

  /**
   * Routes `members` onto the generic form-backed island plugin.
   */
  public function getIslandPluginId(string $island_id): string {
    return $island_id === 'members' ? 'configured_form' : $island_id;
  }

  /**
   * {@inheritdoc}
   */
  public function getIslandConfiguration(string $island_id): array {
    if ($island_id === 'members') {
      return [
        'form_class' => GroupMembersForm::class,
        'required_data_key' => 'group',
        'required_data_class' => EntityInterface::class,
        // A finished invite, revoke or add dialog refreshes the list in place.
        'events' => [MembersDialogResponse::EVENT],
      ];
    }
    return [];
  }

  /**
   * The roster's and a member page's routes, and that page's member.
   *
   * The roster links each row to `bb_core.<type>.member`; a member page
   * (its route carries `{user}`) shows that member alone and returns to
   * `bb_core.<type>.members` after a removal. The workspace slug is filled
   * in from the current workspace.
   *
   * @param string $type
   *   The group's entity type id, which names both routes.
   * @param array<string, int|string> $parameters
   *   The route parameters naming the group, beyond the workspace.
   *
   * @return array<string, mixed>
   *   `routes` (`list` and `member`, each a route name and its parameters)
   *   and, on a member page, `member` (the uid).
   */
  private function memberData(string $type, array $parameters = []): array {
    $member = $this->routeMatch->getParameter('user');
    return [
      'routes' => [
        'list' => ['bb_core.' . $type . '.members', $parameters],
        'member' => ['bb_core.' . $type . '.member', $parameters],
      ],
    ] + ($member instanceof UserInterface ? ['member' => (int) $member->id()] : []);
  }

  /**
   * {@inheritdoc}
   *
   * The roster refreshes on its own after a dialog; that request names the
   * island by a client-sent id, so it gets the gate of the page it lives on.
   */
  public function accessIsland(string $island_id, AccountInterface $account): AccessResultInterface {
    $group = $this->getIslandData($island_id)['group'] ?? NULL;
    if ($island_id !== 'members' || !$group instanceof EntityInterface) {
      return AccessResult::forbidden()->addCacheContexts(['route']);
    }
    return AccessResult::allowed()->addCacheContexts(['route'])
      ->andIf($group->access(self::MEMBERS_ACCESS, $account, TRUE));
  }

}
