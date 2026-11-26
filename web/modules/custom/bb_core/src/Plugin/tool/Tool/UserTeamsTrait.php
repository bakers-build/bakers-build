<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\tool\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;

/**
 * A user's team rows as the user tools return them.
 *
 * Needs the `$readScope` property and `entities()` of the using tool.
 */
trait UserTeamsTrait {

  /**
   * The workspace OG role prefix in front of a rank.
   */
  private const RANK_PREFIX = 'bb_workspace-bb_workspace-';

  /**
   * The user's teams the caller may read, with the user's workspace rank.
   *
   * @return array<array<string, string|null>>
   *   Team rows, by name.
   */
  private function teams(UserInterface $user): array {
    $readable = $this->readScope->membershipGroupIds($this->currentUser)['bb_team'] ?? [];
    if ($readable === []) {
      return [];
    }
    $membership_ids = $this->entities()->getStorage('og_membership')->getQuery()->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', $readable, 'IN')
      ->condition('uid', $user->id())
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->execute();
    $memberships = $this->entities()->getStorage('og_membership')->loadMultiple($membership_ids);
    $ids = array_map(static fn ($membership) => $membership instanceof OgMembershipInterface ? $membership->getGroupId() : 0, $memberships);
    $teams = [];
    foreach ($this->entities()->getStorage('bb_team')->loadMultiple($ids) as $team) {
      assert($team instanceof ContentEntityInterface);
      $workspace = $team->get('workspace_id')->entity;
      $teams[] = [
        'uuid' => (string) $team->uuid(),
        'label' => (string) $team->label(),
        'workspace' => $workspace?->uuid(),
        'role' => $workspace ? $this->rank($workspace, $user) : NULL,
      ];
    }
    usort($teams, static fn (array $a, array $b): int => strcmp($a['label'], $b['label']));
    return $teams;
  }

  /**
   * The user's standard workspace rank (lead, contributor, guest), if any.
   */
  private function rank(EntityInterface $workspace, UserInterface $user): ?string {
    foreach (Og::getMembership($workspace, $user)?->getRoles() ?? [] as $role) {
      if ($role->getRoleType() === 'standard' && str_starts_with((string) $role->id(), self::RANK_PREFIX)) {
        return substr((string) $role->id(), strlen(self::RANK_PREFIX));
      }
    }
    return NULL;
  }

}
