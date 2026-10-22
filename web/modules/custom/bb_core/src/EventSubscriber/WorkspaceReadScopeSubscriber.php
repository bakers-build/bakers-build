<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessEvent;
use Drupal\bb_core\Access\BbGroupScopedAccount;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Access\MembershipResolutionGuard;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Narrows every bakers.build collection query to the account's OG read scope.
 *
 * Organic Groups decides access per entity, never per query; this subscriber
 * adds one condition per in-scope entity type. It listens on the qualified
 * `entity.query_access.<type>` events, so non-bakers.build types are never
 * touched.
 *
 * Narrowing is `AND(<original>, <ours>)` because appending to `OR` widens, and
 * conditions stay single-level because Views maps a traversal onto the wrong
 * column.
 *
 * @see \Drupal\bb_core\Access\BbWorkspaceReadScope
 * @see bb_core_jsonapi_entity_filter_access()
 */
final class WorkspaceReadScopeSubscriber implements EventSubscriberInterface {

  /**
   * The id set each rule term draws its values from.
   */
  private const SET_WORKSPACES = 'workspaces';
  private const SET_PROJECTS = 'projects';
  private const SET_PEOPLE = 'people';
  /**
   * The workspaces where the account may view ticket templates.
   *
   * Narrower than SET_WORKSPACES, which holds guest memberships too: the
   * template permission is an OG union, so a rank elsewhere must not open a
   * workspace the account is only a guest of.
   */
  private const SET_TEMPLATE_WORKSPACES = 'template_workspaces';
  /**
   * The one set that is not a flat id list but a map keyed by group type.
   *
   * `og_membership` anchors a row on the PAIR (`entity_type`, `entity_id`), so
   * its term expands into one discriminated `AND(entity_type, entity_id IN …)`
   * per group type rather than into a single `IN`. A flat union would let a
   * team of another workspace be read whenever its id matched an in-scope
   * project's, and both id sequences start at 1.
   */
  private const SET_MEMBERSHIP_GROUPS = 'membership_groups';

  /**
   * The membership entity type, whose rule is conditional in three ways.
   */
  private const MEMBERSHIP_ENTITY_TYPE_ID = 'og_membership';

  /**
   * The field naming a membership's group entity type.
   */
  private const MEMBERSHIP_GROUP_TYPE_FIELD = 'entity_type';

  /**
   * The permissions that bypass the membership rule entirely.
   *
   * Named here rather than derived, because `og_membership` declares no
   * `admin_permission`: `isBypassed()` therefore falls back to a permission
   * (`administer og_membership`) that does not exist and nobody can hold, which
   * would narrow uid 1 and every `administer bakers` operator too. Both
   * bypasses are listed — bakers.build's own, so a membership collection
   * behaves like every other bakers.build collection for an administrator, and
   * OG's, so OG's site-wide administrator keeps the reach OG gives it.
   *
   * @var array<string>
   */
  private const MEMBERSHIP_BYPASS_PERMISSIONS = [
    'administer bakers',
    'administer organic groups',
  ];

  /**
   * The types whose own handler already grants the row's owner.
   *
   * BbOwnerGrantQueryAccessHandler puts `owner_user_id = <uid>` into an `OR`
   * group, and `bakers ui` depends on it: the Conductors tab reads conductors
   * and runs through that grant alone. So the scope condition for these two
   * types carries the owner as a further `OR` member and the composition can
   * never remove it.
   *
   * @var array<string>
   */
  private const OWNER_GRANTED_ENTITY_TYPES = [
    'bb_run',
    'bb_conductor',
    // An account always reads its OWN membership, whatever the group: OG
    // resolves ranks via `getMembership($group, $self)` with
    // `accessCheck(TRUE)`, so without this term a membership in a group the
    // account cannot otherwise see would answer NULL and the rank would vanish.
    self::MEMBERSHIP_ENTITY_TYPE_ID,
  ];

  /**
   * The prefix that turns a ticket rule term into a child's term.
   */
  private const CHILD_FIELD_PREFIX = 'ticket_id.entity.';

  /**
   * Constructs a WorkspaceReadScopeSubscriber.
   *
   * @param \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface $readScope
   *   The resolver of the account's id sets.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager, for the owner key of the two granted types.
   * @param \Drupal\bb_core\Access\MembershipResolutionGuard $guard
   *   The guard that tells this listener when bakers.build's own membership
   *   resolution is on the stack, so the og_membership rule does not filter the
   *   reads it is computed from.
   * @param \Drupal\bb_core\Access\BbRankCapabilityInterface $capability
   *   Answers a permission per workspace rather than as the OG union.
   */
  public function __construct(
    private readonly BbWorkspaceReadScopeInterface $readScope,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly MembershipResolutionGuard $guard,
    private readonly BbRankCapabilityInterface $capability,
  ) {
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, string>
   *   One listener per in-scope entity type, on the qualified event name.
   */
  public static function getSubscribedEvents(): array {
    $events = [];
    foreach (self::inScopeEntityTypeIds() as $entity_type_id) {
      $events['entity.query_access.' . $entity_type_id] = 'onQueryAccess';
    }
    return $events;
  }

  /**
   * The entity types this subscriber narrows.
   *
   * The JSON:API filter-access hook reads this set and adds the types that set
   * `bb_jsonapi_filter_scope`, whose query handler is not a subscriber rule.
   * A type narrowed but not covered would empty every filtered read of it
   * with HTTP 200 and no log line.
   *
   * @return array<string>
   *   The entity type ids, in rule-map order.
   */
  public static function inScopeEntityTypeIds(): array {
    return array_keys(self::rules());
  }

  /**
   * The entity types whose rule contains a traversing condition field.
   *
   * Derived from the rule map rather than listed, so the Views guard that reads
   * it keeps holding when the ticket anchor grows and the child types inherit
   * another traversal. A traversing condition is mapped
   * onto the wrong column by ViewsQueryAlter, so a View over one of these types
   * must stay gated on `administer bakers`.
   *
   * @return array<string>
   *   The entity type ids.
   */
  public static function traversingEntityTypeIds(): array {
    $traversing = [];
    foreach (self::rules() as $entity_type_id => $rule) {
      foreach ($rule['terms'] as [$field]) {
        if (str_contains($field, '.')) {
          $traversing[] = $entity_type_id;
          break;
        }
      }
    }
    return $traversing;
  }

  /**
   * The per-entity-type rule map.
   *
   * A rule is a conjunction plus a list of (field, id set) terms. `bb_ticket`
   * is the anchor and `bb_run` / `bb_comment` DERIVE from it by prefixing
   * every field — they carry no copy of the ticket rule.
   *
   * A restated child rule would diverge silently: a comment visible whose
   * ticket is not (disclosure of the handoff), or a ticket whose comments and
   * runs are hidden. Team assignment does not widen ticket access; the anchor
   * stays `project_id IN projectIds`.
   *
   * @return array<string, array{conjunction: string, terms: array<array{string, string}>}>
   *   The rules, keyed by entity type id.
   */
  private static function rules(): array {
    // The ticket anchor. The conjunction is stated even though a single term
    // does not need one, because the derivation copies it.
    $anchor = [
      'conjunction' => 'OR',
      'terms' => [['project_id', self::SET_PROJECTS]],
    ];

    return [
      'bb_workspace' => [
        'conjunction' => 'OR',
        'terms' => [['id', self::SET_WORKSPACES]],
      ],
      'bb_group' => [
        'conjunction' => 'OR',
        'terms' => [['workspace_id', self::SET_WORKSPACES]],
      ],
      // Teams are workspace data: visible only inside the account's workspaces
      // Membership alone does not open the team collection.
      'bb_team' => [
        'conjunction' => 'OR',
        'terms' => [['workspace_id', self::SET_WORKSPACES]],
      ],
      // Shared vocabulary, but per workspace: every workspace carries its own
      // `work:code`. Single-level, so it maps correctly on the
      // entity-query and the Views surface alike, and traversingEntityTypeIds()
      // stays unchanged.
      'bb_term' => [
        'conjunction' => 'OR',
        'terms' => [['workspace_id', self::SET_WORKSPACES]],
      ],
      'bb_project' => [
        'conjunction' => 'OR',
        'terms' => [['id', self::SET_PROJECTS]],
      ],
      'bb_ticket' => $anchor,
      // Exactly one of the two is set, so a project template stays readable
      // only through its project.
      'bb_ticket_template' => [
        'conjunction' => 'OR',
        'terms' => [['project_id', self::SET_PROJECTS], ['workspace_id', self::SET_TEMPLATE_WORKSPACES]],
      ],
      'bb_environment' => [
        'conjunction' => 'OR',
        'terms' => [['project_id', self::SET_PROJECTS]],
      ],
      'bb_conductor' => [
        'conjunction' => 'OR',
        'terms' => [['project_id', self::SET_PROJECTS]],
      ],
      'bb_run' => self::deriveFromTicket($anchor),
      'bb_comment' => self::deriveFromTicket($anchor),
      'user' => [
        'conjunction' => 'OR',
        'terms' => [['uid', self::SET_PEOPLE]],
      ],
      // The single term expands into one discriminated pair per group entity
      // type; see SET_MEMBERSHIP_GROUPS and ::membershipScope().
      self::MEMBERSHIP_ENTITY_TYPE_ID => [
        'conjunction' => 'OR',
        'terms' => [['entity_id', self::SET_MEMBERSHIP_GROUPS]],
      ],
    ];
  }

  /**
   * Derives a child rule from the ticket anchor by prefixing every field.
   *
   * @param array{conjunction: string, terms: array<array{string, string}>} $anchor
   *   The ticket rule.
   *
   * @return array{conjunction: string, terms: array<array{string, string}>}
   *   The same rule, reachable through bb_run/bb_comment's ticket_id.
   */
  private static function deriveFromTicket(array $anchor): array {
    $anchor['terms'] = array_map(
      static fn(array $term): array => [self::CHILD_FIELD_PREFIX . $term[0], $term[1]],
      $anchor['terms'],
    );
    return $anchor;
  }

  /**
   * Narrows one entity type's finished condition group to the read scope.
   *
   * @param \Drupal\entity\QueryAccess\QueryAccessEvent $event
   *   The query access event, carrying the group the handler just built.
   */
  public function onQueryAccess(QueryAccessEvent $event): void {
    // A READ scope. Write access is BbWriteScope's and the access control
    // handlers' job, and narrowing an update query here would silently change
    // what those two already decided.
    if ($event->getOperation() !== 'view') {
      return;
    }
    $entity_type_id = $event->getEntityTypeId();
    $rule = self::rules()[$entity_type_id] ?? NULL;
    if ($rule === NULL) {
      return;
    }
    $conditions = $event->getConditions();
    $account = $event->getAccount();

    // Guard 1 — the account already sees nothing. Adding to a falsified group
    // is noise, and bb_core_jsonapi_entity_filter_access() must keep
    // reporting no allowed subset for it.
    if ($conditions->isAlwaysFalse()) {
      return;
    }
    // Guard 1b — the membership type's three own exemptions, BEFORE guard 2.
    // Order matters: guard 2 asks hasPermission(), and on this one type that
    // question can be asked from inside permission calculation itself.
    if (
      $entity_type_id === self::MEMBERSHIP_ENTITY_TYPE_ID
      && !$this->membershipScopeApplies($account)
    ) {
      return;
    }
    // Guard 2 — the type's admin permission. An empty group means full access
    // WITHOUT saying why, so the permission is tested rather than the
    // shape. Without this guard the change revokes access from uid 1, which is
    // the Playwright suite and every drush path.
    if ($this->readScope->isBypassed($account, $entity_type_id)) {
      return;
    }

    // The conditions depend on the account's memberships. A missing context
    // leaks one account's rows into another's cached response, and that failure
    // is invisible in a single-user test.
    $conditions->addCacheContexts(['user']);
    $conditions->addCacheTags(['og_membership_list']);

    $scope = $this->buildScopeCondition($entity_type_id, $rule, $account);
    // Guard 3 — nothing to scope by. `IN ()` is a database-level accident
    // waiting to differ per driver, and "no membership means no rows" is the
    // isolation property stated once, explicitly.
    if ($scope->count() === 0) {
      $conditions->alwaysFalse();
      return;
    }
    $this->narrow($conditions, $scope);
  }

  /**
   * Whether the membership rule may narrow this account's query at all.
   *
   * Exempt: bakers.build's own membership resolution (a falsified one makes
   * every account look rankless; see MembershipResolutionGuard); anonymous,
   * because drush/deploy/cron paths look up someone else's membership and a
   * NULL answer makes the caller's `Og::createMembership()` abort as a
   * duplicate, while the access handler still refuses anonymous every row; and
   * the admin bypass permissions, because og_membership declares no
   * `admin_permission`.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account being narrowed.
   *
   * @return bool
   *   TRUE when the rule applies.
   */
  private function membershipScopeApplies(AccountInterface $account): bool {
    if ($this->guard->isResolving() || (int) $account->id() === 0) {
      return FALSE;
    }
    foreach (self::MEMBERSHIP_BYPASS_PERMISSIONS as $permission) {
      if ($account->hasPermission($permission)) {
        return FALSE;
      }
    }

    return TRUE;
  }

  /**
   * Builds the scope condition for one entity type, or an empty group.
   *
   * A term whose id set is empty is dropped rather than written as `IN ()`, so
   * an empty result means "this account has no scope on this type" — which is
   * what guard 3 reads. For the two owner-granted types the owner term is
   * always present, which is precisely why they never falsify.
   *
   * @param string $entity_type_id
   *   The entity type being narrowed.
   * @param array{conjunction: string, terms: array<array{string, string}>} $rule
   *   The rule for that type.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account being narrowed.
   *
   * @return \Drupal\entity\QueryAccess\ConditionGroup
   *   The scope condition; empty when the account has no scope at all.
   */
  private function buildScopeCondition(string $entity_type_id, array $rule, AccountInterface $account): ConditionGroup {
    $anchor = new ConditionGroup($rule['conjunction']);
    foreach ($rule['terms'] as [$field, $set]) {
      if ($set === self::SET_MEMBERSHIP_GROUPS) {
        $this->addMembershipTerms($anchor, $field, $account);
        continue;
      }
      $ids = $this->idSet($set, $account);
      if ($ids === []) {
        continue;
      }
      $anchor->addCondition($field, $ids, 'IN');
    }

    $owner_key = $this->ownerGrantKey($entity_type_id, $account);
    if ($owner_key === NULL) {
      return $anchor;
    }
    $scope = new ConditionGroup('OR');
    // $account->id() is passed VERBATIM: a cast breaks
    // the identity comparison entity_jsonapi_entity_filter_access() makes on
    // the owner subset.
    $scope->addCondition($owner_key, $account->id());
    if ($anchor->count() > 0) {
      $scope->addCondition($anchor);
    }
    return $scope;
  }

  /**
   * Adds one discriminated `AND(entity_type, entity_id IN …)` per group type.
   *
   * `og_membership.entity_id` is a STRING field carrying the group's numeric
   * id, and every group type has its own id sequence starting at 1, so a flat
   * `entity_id IN (…)` would return a foreign team's roster on id collision.
   * A type whose set is empty is dropped rather than written as `IN ()`, so
   * guard 3 still reads "no pairs" as "no scope".
   *
   * @param \Drupal\entity\QueryAccess\ConditionGroup $anchor
   *   The OR group to add the pairs to.
   * @param string $field
   *   The field holding the group id (`entity_id`).
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account being narrowed.
   */
  private function addMembershipTerms(ConditionGroup $anchor, string $field, AccountInterface $account): void {
    foreach ($this->readScope->membershipGroupIds($account) as $group_type => $ids) {
      if ($ids === []) {
        continue;
      }
      $pair = new ConditionGroup('AND');
      $pair->addCondition(self::MEMBERSHIP_GROUP_TYPE_FIELD, $group_type);
      // Compared as STRINGS, because the column is one. An integer
      // list works on MySQL by coercion and is a different query plan.
      $pair->addCondition($field, array_map('strval', $ids), 'IN');
      $anchor->addCondition($pair);
    }
  }

  /**
   * Returns the owner key to grant beside the scope, or NULL.
   *
   * @param string $entity_type_id
   *   The entity type being narrowed.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account being narrowed.
   *
   * @return string|null
   *   The owner entity key, or NULL when this type carries no owner grant or
   *   the account cannot own anything.
   */
  private function ownerGrantKey(string $entity_type_id, AccountInterface $account): ?string {
    if (!in_array($entity_type_id, self::OWNER_GRANTED_ENTITY_TYPES, TRUE)) {
      return NULL;
    }
    // Anonymous owns nothing. Core stores an entity-key column NOT NULL, so an
    // unowned row carries owner 0 and anonymous would match every one of them.
    if ((int) $account->id() === 0) {
      return NULL;
    }
    if ($entity_type_id === self::MEMBERSHIP_ENTITY_TYPE_ID) {
      // og_membership implements EntityOwnerInterface but declares NO `owner`
      // entity key — measured, not assumed: getKeys() answers uuid, id, bundle
      // and the langcode/revision set and nothing else. So the field is named
      // here. Derivation would return NULL and drop the term with no error,
      // which is the one failure this whole grant exists to prevent.
      return 'uid';
    }
    $owner_key = $this->entityTypeManager->getDefinition($entity_type_id)
      ->getKey('owner');
    return is_string($owner_key) && $owner_key !== '' ? $owner_key : NULL;
  }

  /**
   * Returns one of the resolved id sets.
   *
   * @param string $set
   *   The set name from the rule term.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to resolve for.
   *
   * @return array<int>
   *   The ids.
   */
  private function idSet(string $set, AccountInterface $account): array {
    return match ($set) {
      self::SET_WORKSPACES => $this->readScope->workspaceIds($account),
      self::SET_PROJECTS => $this->readScope->projectIds($account),
      self::SET_PEOPLE => $this->readScope->peopleIds($account),
      self::SET_TEMPLATE_WORKSPACES => $this->workspacesGranting($account, 'view bb_ticket_template'),
      // A rule term naming a set that does not exist is a programming error,
      // and it must not degrade into an empty id list: guard 3 would read that
      // as "no scope" and falsify the query, which looks exactly like correct
      // isolation.
      default => throw new \LogicException(
        sprintf('Unknown read-scope id set "%s".', $set),
      ),
    };
  }

  /**
   * Returns the account's workspaces in which it holds a permission.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account being narrowed.
   * @param string $permission
   *   The permission, asked per workspace.
   *
   * @return array<int>
   *   The workspace ids.
   */
  private function workspacesGranting(AccountInterface $account, string $permission): array {
    $ids = $this->readScope->workspaceIds($account);
    if ($ids === []) {
      return [];
    }
    $scoped = [];
    foreach ($this->entityTypeManager->getStorage('bb_workspace')->loadMultiple($ids) as $id => $workspace) {
      if ((new BbGroupScopedAccount($account, [$workspace], $this->capability))->hasPermission($permission)) {
        $scoped[] = (int) $id;
      }
    }
    return $scoped;
  }

  /**
   * Replaces a group's conditions with `AND(<original>, <scope>)`.
   *
   * The group cannot be swapped for another object — the handler returns the
   * one it built — and its conjunction is fixed at construction, so narrowing
   * is done by rewriting its member list to a single nested `AND`. A
   * single-member group is its member, so the outer conjunction stops
   * mattering.
   *
   * @param \Drupal\entity\QueryAccess\ConditionGroup $conditions
   *   The group the handler built, mutated in place.
   * @param \Drupal\entity\QueryAccess\ConditionGroup $scope
   *   The scope condition to narrow it by.
   */
  private function narrow(ConditionGroup $conditions, ConditionGroup $scope): void {
    $conjunction = $conditions->getConjunction();
    // Asserted rather than assumed: appending to an `OR` group would widen, and
    // a widened read scope is the one failure this class must never produce.
    assert($conjunction === 'AND' || $conjunction === 'OR');
    $original_members = $conditions->getConditions();

    $narrowed = new ConditionGroup('AND');
    if ($original_members !== []) {
      $original = new ConditionGroup($conjunction);
      self::replaceMembers($original, $original_members);
      $narrowed->addCondition($original);
    }
    $narrowed->addCondition($scope);

    self::replaceMembers(
      $conditions,
      $narrowed->count() === 1 ? $narrowed->getConditions() : [$narrowed],
    );
  }

  /**
   * Overwrites a condition group's member list.
   *
   * ConditionGroup::getConditions() returns the member array by reference for
   * exactly this purpose. Cacheability is added to the OUTER group by the
   * caller rather than carried by the members, so nothing is lost here.
   *
   * Written with array_splice() rather than a plain assignment because the
   * reference is the whole point: a bare `$slot = $members` never READS $slot,
   * which reads to a static analyser as a dead local rather than as a write
   * through a reference.
   *
   * @param \Drupal\entity\QueryAccess\ConditionGroup $group
   *   The group to rewrite.
   * @param array<\Drupal\entity\QueryAccess\Condition|\Drupal\entity\QueryAccess\ConditionGroup> $members
   *   The new members.
   */
  private static function replaceMembers(ConditionGroup $group, array $members): void {
    $slot = &$group->getConditions();
    array_splice($slot, 0, count($slot), $members);
  }

}
