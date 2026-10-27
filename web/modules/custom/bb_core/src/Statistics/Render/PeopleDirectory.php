<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Render;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\og\MembershipManagerInterface;
use Drupal\user\UserInterface;

/**
 * The person and team cells of the Insights People table.
 */
final class PeopleDirectory {

  use PersonIdentityTrait;

  public function __construct(
    private readonly EntityRepositoryInterface $entityRepository,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ?MembershipManagerInterface $membershipManager,
  ) {}

  /**
   * Cells per row key: the person, and their teams in the workspace.
   *
   * @param \Drupal\Core\Entity\EntityInterface $workspace
   *   The workspace whose teams are named.
   * @param array<int, string> $keys
   *   Row keys: user UUIDs and `unattributed`.
   *
   * @return array<string, array<string, array<string, mixed>>>
   *   `label` and `team` cells keyed by row key.
   */
  public function cells(EntityInterface $workspace, array $keys): array {
    $teams = $this->entityTypeManager->getStorage('bb_team')->loadByProperties(['workspace_id' => $workspace->id()]);
    uasort($teams, static fn(EntityInterface $left, EntityInterface $right): int => strnatcasecmp((string) $left->label(), (string) $right->label()));
    $cells = [];
    foreach ($keys as $key) {
      $account = $key === 'unattributed' ? NULL : $this->entityRepository->loadEntityByUuid('user', $key);
      if (!$account instanceof UserInterface) {
        $cells[$key] = [
          'label' => [
            'kind' => 'person',
            'display_name' => 'Unassigned tickets',
            'initials' => '?',
            'color' => 'offline',
          ],
          'team' => ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'],
        ];
        continue;
      }
      $name = $this->personDisplayName($account);
      $names = [];
      foreach ($teams as $team) {
        if ($this->membershipManager?->getMembership($team, (int) $account->id()) !== NULL) {
          $names[] = (string) $team->label();
        }
      }
      $cells[$key] = [
        'label' => [
          'kind' => 'person',
          'display_name' => $name,
          'initials' => $this->personInitials($name),
          'color' => $this->personColor((int) $account->id()),
        ],
        'team' => $names === []
          ? ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint']
          : ['kind' => 'text', 'value' => implode(', ', $names)],
      ];
    }
    return $cells;
  }

}
