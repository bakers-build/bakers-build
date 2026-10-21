<?php

declare(strict_types=1);

namespace Drupal\bb_track;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;

/**
 * Single policy source for reading other people's time.
 *
 * Only accounts holding `view team worklogs` on a team (the team lead role)
 * read the entries of that team's active members on projects of the team's
 * workspace. Read access never implies editing.
 */
final class WorklogScope {

  public const PERMISSION = 'view team worklogs';

  /**
   * Led team scopes per uid for this request.
   *
   * @var array<int, list<array{team: int, owners: list<int>, projects: list<int>}>>
   */
  private array $scopes = [];

  /**
   * Constructs the scope.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbRankCapabilityInterface $rank,
  ) {}

  /**
   * Teams the account leads, with their active members and projects.
   *
   * @return list<array{team: int, owners: list<int>, projects: list<int>}>
   *   One scope per led team.
   */
  public function ledTeamScopes(AccountInterface $account): array {
    $uid = (int) $account->id();
    if ($uid === 0) {
      return [];
    }
    return $this->scopes[$uid] ??= $this->buildScopes($account);
  }

  /**
   * Whether the account leads this team.
   */
  public function leads(AccountInterface $account, BbTeamInterface $team): bool {
    return in_array((int) $team->id(), array_column($this->ledTeamScopes($account), 'team'), TRUE);
  }

  /**
   * Whether the account may read this entry.
   */
  public function canView(Worklog $entry, AccountInterface $account): bool {
    if ($account->isAnonymous()) {
      return FALSE;
    }
    $owner = (int) $entry->getOwnerId();
    if ($owner === (int) $account->id()) {
      return TRUE;
    }
    // Proposed time is unbooked and stays private to its owner.
    if ($entry->get('voided')->value || $entry->get('state')->value === 'proposed') {
      return FALSE;
    }
    $project = (int) $entry->get('project_id')->target_id;
    foreach ($this->ledTeamScopes($account) as $scope) {
      if (in_array($owner, $scope['owners'], TRUE) && in_array($project, $scope['projects'], TRUE)) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Person filter options for a calendar context.
   *
   * @return array<int, string>
   *   Display names keyed by uid, sorted by name.
   */
  public function people(AccountInterface $account, string $context, ?EntityInterface $subject): array {
    $uids = match (TRUE) {
      $context === 'team' && $subject instanceof BbTeamInterface => $this->teamOwners($account, $subject),
      $context === 'project' && $subject instanceof BbProjectInterface => $this->projectOwners($account, $subject),
      default => [],
    };
    $people = [];
    foreach ($this->entityTypeManager->getStorage('user')->loadMultiple(array_unique($uids)) as $user) {
      if ($user instanceof UserInterface) {
        $people[(int) $user->id()] = (string) $user->getDisplayName();
      }
    }
    asort($people);
    return $people;
  }

  /**
   * Active members of a team the account leads.
   *
   * @return list<int>
   *   Uids, empty when the account does not lead the team.
   */
  private function teamOwners(AccountInterface $account, BbTeamInterface $team): array {
    foreach ($this->ledTeamScopes($account) as $scope) {
      if ($scope['team'] === (int) $team->id()) {
        return $scope['owners'];
      }
    }
    return [];
  }

  /**
   * The account plus members of led teams that reach the project.
   *
   * @return list<int>
   *   Uids.
   */
  private function projectOwners(AccountInterface $account, BbProjectInterface $project): array {
    if ($account->isAnonymous()) {
      return [];
    }
    $uids = [(int) $account->id()];
    foreach ($this->ledTeamScopes($account) as $scope) {
      if (in_array((int) $project->id(), $scope['projects'], TRUE)) {
        $uids = array_merge($uids, $scope['owners']);
      }
    }
    return $uids;
  }

  /**
   * Drops memoised scopes, e.g. after membership changes.
   */
  public function reset(): void {
    $this->scopes = [];
  }

  /**
   * Builds the led team scopes for an account.
   *
   * @return list<array{team: int, owners: list<int>, projects: list<int>}>
   *   One scope per led team.
   */
  private function buildScopes(AccountInterface $account): array {
    $storage = $this->entityTypeManager->getStorage('og_membership');
    // Trusted policy read: the og_membership read scope of the current user
    // must not hide another account's memberships.
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('uid', $account->id())
      ->condition('entity_type', 'bb_team')
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->sort('entity_id')
      ->execute();
    $team_ids = [];
    foreach ($storage->loadMultiple($ids) as $membership) {
      if ($membership instanceof OgMembershipInterface) {
        $team_ids[] = $membership->getGroupId();
      }
    }
    $scopes = [];
    // The role on the membership, never hasGroupPermission(): OG's
    // group_manager_full_access hands every permission to a team's owner.
    foreach ($this->entityTypeManager->getStorage('bb_team')->loadMultiple($team_ids) as $team) {
      if (!$team instanceof BbTeamInterface || !$this->rank->hasGroupRolePermission($account, self::PERMISSION, $team)) {
        continue;
      }
      $scopes[] = [
        'team' => (int) $team->id(),
        'owners' => $this->activeMemberIds($team),
        'projects' => $this->workspaceProjectIds((int) $team->get('workspace_id')->target_id),
      ];
    }
    return $scopes;
  }

  /**
   * Active member uids of a team.
   *
   * @return list<int>
   *   Sorted uids.
   */
  private function activeMemberIds(BbTeamInterface $team): array {
    $storage = $this->entityTypeManager->getStorage('og_membership');
    // Trusted policy read: the og_membership read scope must not filter it.
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', $team->id())
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->execute();
    $uids = [];
    foreach ($storage->loadMultiple($ids) as $membership) {
      if ($membership instanceof OgMembershipInterface) {
        $uids[] = (int) $membership->getOwnerId();
      }
    }
    $uids = array_values(array_unique($uids));
    sort($uids);
    return $uids;
  }

  /**
   * Project ids of a workspace, unfiltered by the caller's access.
   *
   * @return list<int>
   *   Project ids.
   */
  public function workspaceProjectIds(int $workspace_id): array {
    $ids = $this->entityTypeManager->getStorage('bb_project')->getQuery()
      ->accessCheck(FALSE)
      ->condition('group_id.entity.workspace_id', $workspace_id)
      ->execute();
    return array_map('intval', array_values($ids));
  }

}
