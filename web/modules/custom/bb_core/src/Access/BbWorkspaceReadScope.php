<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\og\MembershipManagerInterface;
use Drupal\og\OgMembershipInterface;

/**
 * Resolves a bakers.build read scope from Organic Groups membership.
 *
 * Mirrors BbWriteScope: a per-account resolver of id sets, memoised for the
 * request. Three queries answer every entity type that asks: one
 * og_membership query (memoised by OG's MembershipManager), one project
 * resolution and one people resolution. The memo of one account is dropped
 * via ::reset() when its memberships change.
 *
 * @see \Drupal\bb_core\EventSubscriber\WorkspaceReadScopeSubscriber
 */
final class BbWorkspaceReadScope implements BbWorkspaceReadScopeInterface {

  /**
   * The workspace roles that see every project of their workspace.
   *
   * Only `lead`; a conductor sees what its owning user's rank sees.
   *
   * @var array<string>
   */
  public const SEE_ALL_WORKSPACE_ROLE_IDS = [
    'bb_workspace-bb_workspace-lead',
  ];

  /**
   * The chained condition a project reaches its workspace through.
   *
   * Public so TenancyGraphDriftTest can compare it with the other copies of
   * the tenancy graph.
   *
   * @var string
   */
  public const PROJECT_WORKSPACE_CONDITION = 'group_id.entity.workspace_id';

  /**
   * The multi-valued field a project reaches its teams through.
   *
   * @var string
   */
  public const PROJECT_TEAMS_FIELD = 'teams';

  /**
   * The resolved sets per user id.
   *
   * @var array<int, array{workspaces: array<int>, projects: array<int>, people: array<int>}>
   */
  private array $resolved = [];

  /**
   * The lazily resolved statistics project sets, per user id.
   *
   * A second memo rather than a fourth key in $resolved: only the statistics
   * request asks for it, and resolving it inside ::resolve() would add a query
   * to every collection read on the instance.
   *
   * @var array<int, array<int>>
   */
  private array $workspaceProjects = [];

  /**
   * The lazily resolved membership group sets, per user id.
   *
   * A third memo, for the same reason as the second: only an `og_membership`
   * read asks for it, and resolving it inside ::resolve() would add a bb_team
   * query to every collection read on the instance.
   *
   * @var array<int, array<string, array<int>>>
   */
  private array $membershipGroups = [];

  /**
   * Constructs a BbWorkspaceReadScope.
   *
   * @param \Drupal\og\MembershipManagerInterface $membershipManager
   *   OG's membership manager.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   * @param \Drupal\bb_core\Access\MembershipResolutionGuard $guard
   *   The re-entrancy guard the og_membership query-access rule reads.
   */
  public function __construct(
    private readonly ?MembershipManagerInterface $membershipManager,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly MembershipResolutionGuard $guard,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public function workspaceIds(AccountInterface $account): array {
    return $this->resolve($account)['workspaces'];
  }

  /**
   * {@inheritdoc}
   */
  public function projectIds(AccountInterface $account): array {
    return $this->resolve($account)['projects'];
  }

  /**
   * {@inheritdoc}
   */
  public function workspaceProjectIds(AccountInterface $account): array {
    $uid = (int) $account->id();
    if (isset($this->workspaceProjects[$uid])) {
      return $this->workspaceProjects[$uid];
    }
    $this->workspaceProjects[$uid] = $this->normalise(array_merge(
      $this->projectIds($account),
      $this->projectsOfWorkspaces($this->workspaceIds($account)),
    ));
    return $this->workspaceProjects[$uid];
  }

  /**
   * {@inheritdoc}
   */
  public function peopleIds(AccountInterface $account): array {
    return $this->resolve($account)['people'];
  }

  /**
   * {@inheritdoc}
   */
  public function membershipGroupIds(AccountInterface $account): array {
    $uid = (int) $account->id();
    if (isset($this->membershipGroups[$uid])) {
      return $this->membershipGroups[$uid];
    }
    $workspaces = $this->workspaceIds($account);

    return $this->membershipGroups[$uid] = [
      'bb_workspace' => $workspaces,
      'bb_project' => $this->projectIds($account),
      'bb_team' => $this->guard->resolving(
        fn (): array => $this->teamsOfWorkspaces($workspaces),
      ),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function reset(?int $uid = NULL): void {
    if ($uid === NULL) {
      $this->resolved = [];
      $this->workspaceProjects = [];
      $this->membershipGroups = [];

      return;
    }
    unset(
      $this->resolved[$uid],
      $this->workspaceProjects[$uid],
      $this->membershipGroups[$uid],
    );
  }

  /**
   * {@inheritdoc}
   */
  public function isBypassed(AccountInterface $account, string $entity_type_id): bool {
    $definition = $this->entityTypeManager->getDefinition($entity_type_id, FALSE);
    $permission = $definition?->getAdminPermission();
    if (!is_string($permission) || $permission === '') {
      // The same fallback QueryAccessHandlerBase::buildConditions() applies, so
      // the guard and the group it guards agree on which permission is meant.
      $permission = 'administer ' . $entity_type_id;
    }
    return $account->hasPermission($permission);
  }

  /**
   * Resolves and memoises all three id sets for an account.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to resolve.
   *
   * @return array{workspaces: array<int>, projects: array<int>, people: array<int>}
   *   The resolved sets.
   */
  private function resolve(AccountInterface $account): array {
    $uid = (int) $account->id();
    if (isset($this->resolved[$uid])) {
      return $this->resolved[$uid];
    }

    // og_membership is itself a narrowed type, so the guard is raised for the
    // whole resolution; see MembershipResolutionGuard.
    return $this->guard->resolving(fn (): array => $this->doResolve($uid));
  }

  /**
   * Resolves all three id sets for one uid, with the guard already raised.
   *
   * @param int $uid
   *   The user id to resolve.
   *
   * @return array{workspaces: array<int>, projects: array<int>, people: array<int>}
   *   The resolved sets.
   */
  private function doResolve(int $uid): array {
    // No OG, no scope: the service is optional during the deploy that enables
    // og (see bb_core.services.yml), and an empty set denies rather than
    // leaks. Not memoised; the container is rebuilt once og is installed.
    if ($this->membershipManager === NULL) {
      return ['workspaces' => [], 'projects' => [], 'people' => [$uid]];
    }
    $groups = $this->membershipManager->getUserGroupIds($uid);
    $workspaces = $this->normalise($groups['bb_workspace'] ?? []);
    // Filtered in PHP off the same cached membership set, so this costs no
    // second query.
    $see_all = $this->membershipManager->getUserGroupIdsByRoleIds(
      $uid,
      self::SEE_ALL_WORKSPACE_ROLE_IDS,
      [OgMembershipInterface::STATE_ACTIVE],
      FALSE,
    );
    // Project access is the union of the projects of every team the account
    // belongs to and every project of a workspace whose SEE_ALL role it holds.
    $projects = array_merge(
      $this->projectsOfTeams($this->normalise($groups['bb_team'] ?? [])),
      $this->projectsOfWorkspaces($this->normalise($see_all['bb_workspace'] ?? [])),
    );
    $people = array_merge([$uid], $this->membersOfWorkspaces($workspaces));

    $this->resolved[$uid] = [
      'workspaces' => $workspaces,
      'projects' => $this->normalise($projects),
      'people' => $this->normalise($people),
    ];
    return $this->resolved[$uid];
  }

  /**
   * Returns every project whose group belongs to one of the given workspaces.
   *
   * The chain is walked here once per request and only its result reaches the
   * filter; a traversing condition is mis-mapped by Views.
   * `accessCheck(FALSE)` because this resolves
   * the ids the filter is about to allow.
   *
   * @param array<int> $workspace_ids
   *   The workspaces whose projects to resolve.
   *
   * @return array<int>
   *   The project ids.
   */
  private function projectsOfWorkspaces(array $workspace_ids): array {
    if ($workspace_ids === []) {
      return [];
    }
    $ids = $this->entityTypeManager->getStorage('bb_project')->getQuery()
      ->accessCheck(FALSE)
      ->condition(self::PROJECT_WORKSPACE_CONDITION, $workspace_ids, 'IN')
      ->execute();
    return $this->normalise($ids);
  }

  /**
   * Returns every project naming one of the given teams.
   *
   * `teams` is multi-valued, so this is an `IN` against the
   * reference column rather than a single-hop equality — a project naming
   * three teams matches this query once per team the account belongs to, and
   * the caller de-duplicates via ::normalise().
   *
   * `accessCheck(FALSE)` for the same reason as ::projectsOfWorkspaces(): this
   * query resolves which ids the filter is about to allow, so checking access
   * would recurse into the very handler being built.
   *
   * @param array<int> $team_ids
   *   The teams whose projects to resolve.
   *
   * @return array<int>
   *   The project ids.
   */
  private function projectsOfTeams(array $team_ids): array {
    if ($team_ids === []) {
      return [];
    }
    $ids = $this->entityTypeManager->getStorage('bb_project')->getQuery()
      ->accessCheck(FALSE)
      ->condition(self::PROJECT_TEAMS_FIELD, $team_ids, 'IN')
      ->execute();
    return $this->normalise($ids);
  }

  /**
   * Returns every team belonging to one of the given workspaces.
   *
   * Resolved to ids rather than written as a condition, like
   * ::projectsOfWorkspaces(). `accessCheck(FALSE)` is required: with `TRUE`
   * the query would enter bb_team's read scope, which resolves this again.
   * The set discloses nothing; these are workspaces the account belongs to.
   *
   * @param array<int> $workspace_ids
   *   The workspaces whose teams to resolve.
   *
   * @return array<int>
   *   The team ids.
   */
  private function teamsOfWorkspaces(array $workspace_ids): array {
    if ($workspace_ids === []) {
      return [];
    }
    $ids = $this->entityTypeManager->getStorage('bb_team')->getQuery()
      ->accessCheck(FALSE)
      ->condition('workspace_id', $workspace_ids, 'IN')
      ->execute();

    return $this->normalise($ids);
  }

  /**
   * Returns every user holding an active membership in the given workspaces.
   *
   * An aggregate query, so the uids come back in one round trip: the plain
   * entity query would return membership ids and force a second load, which
   * would break the three-query budget.
   *
   * @param array<int> $workspace_ids
   *   The workspaces whose members to resolve.
   *
   * @return array<int>
   *   The user ids.
   */
  private function membersOfWorkspaces(array $workspace_ids): array {
    if ($workspace_ids === []) {
      return [];
    }
    $rows = $this->entityTypeManager->getStorage('og_membership')
      ->getAggregateQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_workspace')
      // entity_id is a STRING base field on og_membership, so the
      // values are compared as strings rather than as entity ids.
      ->condition('entity_id', array_map('strval', $workspace_ids), 'IN')
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->groupBy('uid')
      ->execute();
    $uids = [];
    foreach ($rows as $row) {
      if (isset($row['uid'])) {
        $uids[] = (int) $row['uid'];
      }
    }
    return $uids;
  }

  /**
   * Casts, de-duplicates and sorts an id list.
   *
   * @param iterable<mixed> $ids
   *   The raw ids.
   *
   * @return array<int>
   *   The ids as a sorted, unique, zero-indexed integer list.
   */
  private function normalise(iterable $ids): array {
    $normalised = [];
    foreach ($ids as $id) {
      $normalised[(int) $id] = TRUE;
    }
    $keys = array_keys($normalised);
    sort($keys);
    return $keys;
  }

}
