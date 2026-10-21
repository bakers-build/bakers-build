<?php

declare(strict_types=1);

namespace Drupal\bb_core\Island;

use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_core\Form\GroupMembersForm;

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
      ];
    }
    return [];
  }

}
