<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Access\AccessResultReasonInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;

/**
 * Fences the rank permission union back to the granting group.
 *
 * Layer B: the type's own access handler is re-run against a
 * BbGroupScopedAccount that holds permissions inside the entity's tenancy
 * chain only, and a denial there becomes a forbidden hook result. Entity
 * `create` has no entity and is bounded by BbGroupScopeConstraint; the
 * fields of an unsaved row are fenced through checkField().
 *.
 */
final class BbRankEntityFence {

  /**
   * The single reference field that leads one hop up each type's chain.
   *
   * Public so TenancyGraphDriftTest can compare it with the other copies of
   * the tenancy graph. The group types answer for themselves in
   * ::resolveChain() and are absent on purpose.
   *
   * @var array<string, string>
   */
  public const HOP_FIELDS = [
    'bb_group' => 'workspace_id',
    'bb_team' => 'workspace_id',
    'bb_term' => 'workspace_id',
    'bb_invite' => 'workspace_id',
    'bb_ticket' => 'project_id',
    'bb_ticket_template' => 'project_id',
    'bb_ticket_trigger' => 'workspace_id',
    'bb_environment' => 'project_id',
    'bb_conductor' => 'project_id',
    'bb_run' => 'ticket_id',
    'bb_comment' => 'ticket_id',
  ];

  /**
   * The hop taken when the HOP_FIELDS target is empty.
   *
   * A ticket template belongs to exactly one project or one workspace.
   *
   * @var array<string, string>
   */
  public const ALTERNATE_HOP_FIELDS = [
    'bb_ticket_template' => 'workspace_id',
  ];

  /**
   * The field a `bb_project` reaches its workspace through.
   *
   * @var string
   */
  public const PROJECT_WORKSPACE_FIELD = 'group_id';

  /**
   * The multi-valued field a `bb_project` reaches its teams through.
   *
   * @var string
   */
  public const PROJECT_TEAMS_FIELD = 'teams';

  /**
   * The tenancy chain of each entity, keyed "<entity_type>:<id>".
   *
   * @var array<string, array<\Drupal\Core\Entity\EntityInterface>>
   */
  private array $chains = [];

  /**
   * The access checks currently on the stack, keyed "<type>:<id>:<op>:<uid>".
   *
   * The fence re-enters the very handler that invoked it, so the second pass
   * has to fall straight through. Without this the recursion is unbounded.
   *
   * @var array<string, true>
   */
  private array $inProgress = [];

  /**
   * The field checks currently on the stack, keyed per entity/field/op/uid.
   *
   * The same re-entrancy as $inProgress, and it needs its own list because the
   * two paths nest: an entity check may be on the stack while a field check
   * runs. Core's EntityAccessControlHandler::fieldAccess() invokes
   * hook_entity_field_access(), and checkField() calls fieldAccess() — without
   * this the recursion is unbounded.
   *
   * @var array<string, true>
   */
  private array $fieldsInProgress = [];

  /**
   * The scoped accounts already built, keyed "<chain>|<uid>".
   *
   * Memoised because the field hook fires for EVERY field of EVERY entity on
   * every render, and each BbGroupScopedAccount carries its own
   * per-permission answer cache. A fresh instance per field would make each
   * field pay a full OgAccess round trip for the same permissions; sharing one
   * instance per chain turns N field checks into a handful. The cost of this
   * hook is a real consideration and is stated here rather than left silent.
   *
   * @var array<string, \Drupal\bb_core\Access\BbGroupScopedAccount>
   */
  private array $scopedAccounts = [];

  /**
   * Constructs a BbRankEntityFence.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   The entity type manager.
   * @param \Drupal\bb_core\Access\BbRankCapabilityInterface $capability
   *   The rank capability resolver.
   * @param \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface $readScope
   *   The read scope; its projects are where teams let the account in.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly BbRankCapabilityInterface $capability,
    private readonly BbWorkspaceReadScopeInterface $readScope,
  ) {
  }

  /**
   * Decides whether an operation survives its entity's group scope.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity being accessed.
   * @param string $operation
   *   The operation.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   Forbidden when the permission is not held inside the entity's chain,
   *   neutral otherwise — the fence never grants.
   */
  public function check(EntityInterface $entity, string $operation, AccountInterface $account): AccessResultInterface {
    $key = sprintf('%s:%s:%s:%s', $entity->getEntityTypeId(), (string) $entity->id(), $operation, (string) $account->id());
    if (isset($this->inProgress[$key])) {
      return AccessResult::neutral();
    }

    $groups = $this->chainOf($entity);
    if ($groups === []) {
      // No tenancy chain, nothing to fence against: the CONFIG entity types
      // (bb_vocabulary, bb_connector) carry no workspace edge and are
      // governed by `administer bakers`; bb_machine is account-owned and
      // carries none; a row whose anchor is absent or dangling is left to
      // the ordinary checks (see referenced()).
      return AccessResult::neutral();
    }

    // Outside the project's teams no rank counts, only a site-wide grant.
    $scoped = new BbGroupScopedAccount($account, $this->outsideTeams($groups, $entity, $account) ? [] : $groups, $this->capability);
    $handler = $this->entityTypeManager->getAccessControlHandler($entity->getEntityTypeId());

    $this->inProgress[$key] = TRUE;
    try {
      // The handler caches per uuid+operation+langcode+uid, and the scoped
      // account deliberately keeps the real uid, so the two passes would
      // otherwise read each other's answer. Reset on both sides: before, so
      // this pass is really computed; after, so the outer pass is too.
      $handler->resetCache();
      $allowed = $handler->access($entity, $operation, $scoped, TRUE);
      $handler->resetCache();
    }
    finally {
      unset($this->inProgress[$key]);
    }

    // BOTH branches carry the same invalidation, and the symmetry is the point.
    // The decision was reached through OgAccess, whose own cacheable metadata
    // BbRankCapability discards when it reduces the result to a bool — so
    // neither branch inherits the membership's cache tag on its own. Tagging
    // only the denial would leave an ALLOW cached past the moment the
    // membership that justified it was revoked.
    $result = $allowed->isAllowed() ? AccessResult::neutral() : AccessResult::forbidden();

    return $result
      ->addCacheableDependency($allowed)
      ->addCacheContexts(['user'])
      ->addCacheTags(['og_membership_list']);
  }

  /**
   * Whether the chain holds a saved project outside the account's read scope.
   *
   * Teams decide which projects a guest or contributor reaches, and the
   * listings already follow the read scope; entity access follows the same
   * set, so a direct address opens nothing a listing hides.
   *
   * @param array<\Drupal\Core\Entity\EntityInterface> $groups
   *   The entity's chain.
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity being accessed.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account.
   */
  private function outsideTeams(array $groups, EntityInterface $entity, AccountInterface $account): bool {
    $projects = array_filter(
      $groups,
      static fn (EntityInterface $group): bool => $group->getEntityTypeId() === 'bb_project' && $group->id() !== NULL,
    );
    // A conductor follows its owner and registration, not the project's teams.
    if ($projects === [] || $entity->getEntityTypeId() === 'bb_conductor' || $this->readScope->isBypassed($account, $entity->getEntityTypeId())) {
      return FALSE;
    }
    $scope = array_map('intval', $this->readScope->projectIds($account));
    foreach ($projects as $project) {
      if (!in_array((int) $project->id(), $scope, TRUE)) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Decides whether a FIELD operation survives its entity's group scope.
   *
   * The entity-level fence is not enough on its own. An entity type's own
   * checkFieldAccess() asks `$account->hasPermission()` on the REAL account,
   * which since Layer A carries the un-fenced union of every rank the account
   * holds anywhere — so a `lead` rank in workspace B answers for a field of
   * workspace A's ticket. That path is reachable rather than theoretical:
   * entity `update` on A's ticket passes on A's own `member` rank, and only
   * then is the field gate consulted.
   *
   * Same shape as check(): the type's own handler is re-run against a
   * BbGroupScopedAccount, and the fence only ever forbids.
   *
   * @param string $operation
   *   The field operation, `view` or `edit`.
   * @param \Drupal\Core\Field\FieldDefinitionInterface $field_definition
   *   The field definition.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account.
   * @param \Drupal\Core\Field\FieldItemListInterface|null $items
   *   The field items, or NULL — core calls fieldAccess() without them from the
   *   field UI paths, where there is no entity and so no tenancy to fence.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   Forbidden when the field is not permitted inside the entity's chain,
   *   neutral otherwise.
   */
  public function checkField(string $operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    $entity = $items?->getEntity();
    if ($entity === NULL) {
      return AccessResult::neutral();
    }
    $groups = $this->chainOf($entity);
    if ($groups === []) {
      // No tenancy chain, nothing to fence: the CONFIG entity types
      // (bb_vocabulary, bb_connector) carry no workspace edge, and a row
      // whose anchor is absent or dangling is left to the ordinary checks (see
      // referenced()). An UNSAVED entity is not in this branch — its anchor
      // resolves like any other row's.
      return AccessResult::neutral();
    }

    $key = sprintf(
      '%s:%s:%s:%s:%s',
      $entity->getEntityTypeId(),
      (string) $entity->id(),
      $field_definition->getName(),
      $operation,
      (string) $account->id(),
    );
    if (isset($this->fieldsInProgress[$key])) {
      return AccessResult::neutral();
    }

    $handler = $this->entityTypeManager->getAccessControlHandler($entity->getEntityTypeId());
    $scoped = $this->scopedAccount($groups, $account);

    $this->fieldsInProgress[$key] = TRUE;
    try {
      // No resetCache() on this path, unlike check(): fieldAccess() keeps no
      // static cache of its own, so the two passes cannot read each other's
      // answer and there is nothing to clear.
      $allowed = $handler->fieldAccess($operation, $field_definition, $scoped, $items, TRUE);
    }
    finally {
      unset($this->fieldsInProgress[$key]);
    }

    // BOTH branches carry the same invalidation, for the same reason as in
    // check(): tagging only the denial would leave an ALLOW cached past the
    // moment the membership that justified it was revoked.
    $reason = $allowed instanceof AccessResultReasonInterface ? $allowed->getReason() : NULL;
    $result = $allowed->isAllowed() ? AccessResult::neutral() : AccessResult::forbidden($reason);

    return $result
      ->addCacheableDependency($allowed)
      ->addCacheContexts(['user'])
      ->addCacheTags(['og_membership_list']);
  }

  /**
   * Returns the scoped account for one chain and account, building it once.
   *
   * @param array<\Drupal\Core\Entity\EntityInterface> $groups
   *   The tenancy chain, innermost first.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The real account.
   *
   * @return \Drupal\bb_core\Access\BbGroupScopedAccount
   *   The scoped account.
   */
  private function scopedAccount(array $groups, AccountInterface $account): BbGroupScopedAccount {
    $key = implode(',', array_map(
      static fn (EntityInterface $group): string => $group->getEntityTypeId() . ':' . $group->id(),
      $groups,
    )) . '|' . $account->id();

    return $this->scopedAccounts[$key] ??= new BbGroupScopedAccount($account, $groups, $this->capability);
  }

  /**
   * Resolves the groups a row referencing this target would belong to.
   *
   * The create-side fence (BbGroupScopeConstraint) has no row to ask about
   * yet — only the reference it is about to be anchored by. For all six scoped
   * anchors the answer is the same function this class already walks for the
   * row itself: a ticket's `project_id` target resolves to [project,
   * workspace], a comment's `ticket_id` target to the same pair, a project's
   * `group_id` target to [workspace]. Exposed rather than duplicated so the
   * create fence and the read/write fence cannot disagree about where a row
   * lives.
   *
   * @param \Drupal\Core\Entity\EntityInterface $target
   *   The referenced entity.
   *
   * @return array<\Drupal\Core\Entity\EntityInterface>
   *   The groups, innermost first; empty when the chain is unresolvable.
   */
  public function groupsAnchoredBy(EntityInterface $target): array {
    return $this->chainOf($target);
  }

  /**
   * Resolves the OG groups an entity belongs to, innermost first.
   *
   * The chain is walked upward from the entity, so a permission granted at
   * workspace level reaches the tickets below it and a permission granted on
   * one project does not reach its siblings.
   *
   * The reference fields mirror the read scope's anchors, walked one hop at a
   * time.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity.
   *
   * @return array<\Drupal\Core\Entity\EntityInterface>
   *   The groups; empty when the type has no tenancy chain.
   */
  private function chainOf(EntityInterface $entity): array {
    if ($entity->id() === NULL) {
      // The id is only the memo key; an unsaved entity is still fenced from its
      // anchor's chain. The hop graph runs strictly upward, so no cycle.
      return $this->resolveChain($entity);
    }
    $key = $entity->getEntityTypeId() . ':' . $entity->id();
    if (isset($this->chains[$key])) {
      return $this->chains[$key];
    }

    return $this->chains[$key] = $this->resolveChain($entity);
  }

  /**
   * Builds the chain for one entity.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity.
   *
   * @return array<\Drupal\Core\Entity\EntityInterface>
   *   The groups.
   */
  private function resolveChain(EntityInterface $entity): array {
    $entity_type_id = $entity->getEntityTypeId();

    // The group types answer for themselves; everything else is reached by
    // walking ONE reference and asking again. An unsaved group is in its own
    // chain, which grants its creator everything.
    if ($entity_type_id === 'bb_workspace') {
      return [$entity];
    }
    if ($entity_type_id === 'bb_project') {
      // Teams join the chain; the workspace stays so workspace ranks still
      // reach every project.
      return array_merge(
        [$entity],
        $this->workspaceOfProject($entity),
        $this->referencedAll($entity, self::PROJECT_TEAMS_FIELD),
      );
    }
    if ($entity_type_id === 'bb_team') {
      // A team is a create anchor (bb_project.teams), so it must be in its
      // own chain; otherwise any workspace contributor could anchor any team.
      $workspace = $this->referenced($entity, 'workspace_id');
      return $workspace === NULL ? [$entity] : [$entity, $workspace];
    }

    [$field, $target] = $this->hop($entity);
    if ($target === NULL) {
      return [];
    }

    // One hop lands on a group (workspace) or on something that resolves to
    // one (project, ticket) — either way the answer is that target's own chain,
    // which is what makes this recursive rather than a table of full paths.
    return $field === 'workspace_id' ? [$target] : $this->chainOf($target);
  }

  /**
   * The one reference that leads up from an entity, and its target.
   *
   * Only config entity types have no hop: they have no tenant edge. A type
   * with an alternate hop takes it when the primary target is empty.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity.
   *
   * @return array{0: string|null, 1: \Drupal\Core\Entity\EntityInterface|null}
   *   The hop field and its target, NULL when there is none.
   */
  private function hop(EntityInterface $entity): array {
    $entity_type_id = $entity->getEntityTypeId();
    // Only config entity types have no primary hop: they have no tenant edge.
    $primary = self::HOP_FIELDS[$entity_type_id] ?? $this->declaredHop($entity_type_id);
    foreach ([$primary, self::ALTERNATE_HOP_FIELDS[$entity_type_id] ?? NULL] as $field) {
      $target = $field === NULL ? NULL : $this->referenced($entity, $field);
      if ($target !== NULL) {
        return [$field, $target];
      }
    }
    return [NULL, NULL];
  }

  /**
   * Resolves the workspace above a project, through its bb_group.
   *
   * @param \Drupal\Core\Entity\EntityInterface $project
   *   The project.
   *
   * @return array<\Drupal\Core\Entity\EntityInterface>
   *   The workspace, or an empty list when the chain is incomplete.
   */
  private function workspaceOfProject(EntityInterface $project): array {
    $group = $this->referenced($project, self::PROJECT_WORKSPACE_FIELD);
    if ($group === NULL) {
      return [];
    }
    $workspace = $this->referenced($group, 'workspace_id');

    return $workspace === NULL ? [] : [$workspace];
  }

  /**
   * Reads one entity-reference field's target.
   *
   * A dangling reference reads as empty, so an orphan row is not fenced. That
   * fail-open is deliberate.
   * it.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The referring entity.
   * @param string $field
   *   The field name.
   *
   * @return \Drupal\Core\Entity\EntityInterface|null
   *   The target, or NULL when the field is absent, empty or dangling.
   */
  private function referenced(EntityInterface $entity, string $field): ?EntityInterface {
    if (!$entity instanceof FieldableEntityInterface || !$entity->hasField($field)) {
      return NULL;
    }
    $target = $entity->get($field)->entity;

    return $target instanceof EntityInterface ? $target : NULL;
  }

  /**
   * Reads every target of a multi-valued entity-reference field.
   *
   * `->entity` answers only delta 0; dangling items are skipped like in
   * ::referenced().
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The referring entity.
   * @param string $field
   *   The field name.
   *
   * @return array<\Drupal\Core\Entity\EntityInterface>
   *   The targets; empty when the field is absent, empty or every item is
   *   dangling.
   */
  private function referencedAll(EntityInterface $entity, string $field): array {
    if (!$entity instanceof FieldableEntityInterface || !$entity->hasField($field)) {
      return [];
    }
    $item_list = $entity->get($field);
    if (!$item_list instanceof FieldItemListInterface) {
      return [];
    }

    return $item_list->referencedEntities();
  }

  /**
   * The first hop of a type that declares its own `bb_workspace_path`.
   *
   * A module that owns a ticket-scoped type outside bb_core declares the
   * path on its entity type instead of being named here.
   */
  private function declaredHop(string $entity_type_id): ?string {
    $path = $this->entityTypeManager->getDefinition($entity_type_id, FALSE)?->get('bb_workspace_path');
    return is_array($path) && isset($path[0]) ? (string) $path[0] : NULL;
  }

}
