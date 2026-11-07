<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Access\BbRankCapabilityInterface;
use Drupal\bb_core\Access\BbRankEntityFence;
use Drupal\bb_core\Onboarding\OnboardingDestination;
use Drupal\bb_core\RunLog\RunLogPolicy;
use Drupal\og\OgAccess;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Rank-fence hooks: who may act on an entity, and on a field.
 *
 * Both entity hooks ask whether the rank union in the account's permission
 * set reaches THIS entity's tenant, and delegate to BbRankEntityFence.
 * og_user_access_alter() maps bakers.build's entity permissions onto OG's group
 * permissions, using the same fence for the rank half. The field hook also
 * applies the saved-row allowlist for the five editable types.
 *
 *.
 */
final class AccessFenceHooks {

  /**
   * User-editable fields on a saved row, keyed by entity type.
   *
   * Fields absent from this map stay writable through the rank fence only
   * when the row is new. A saved row of one of these types rejects every
   * other field for a non-admin editor.
   *
   * @var array<string, list<string>>
   */
  private const SAVED_ROW_EDITABLE = [
    'bb_workspace' => [
      'name', 'description', 'image', 'billing_profile',
      RunLogPolicy::WORKSPACE_FIELD,
    ],
    'bb_group' => ['name', 'description', 'image', 'billing_profile'],
    'bb_project' => [
      'name', 'description', 'image', 'key', 'repository', 'env_vars',
      'coder_config', 'teams',
    ],
    'bb_machine' => ['name', 'max_parallel'],
    'bb_conductor' => ['label', 'active', 'states'],
  ];

  public function __construct(
    #[Autowire(service: 'bb_core.rank_entity_fence')]
    private readonly BbRankEntityFence $rankEntityFence,
    #[Autowire(service: 'bb_core.rank_capability')]
    private readonly BbRankCapabilityInterface $rankCapability,
  ) {
  }

  /**
   * Implements hook_entity_access().
   *
   * Layer B: fences the rank union back to the group that granted it. A
   * forbidden hook result wins over the handler's own answer.
   */
  #[Hook('entity_access')]
  public function entityAccess(
    EntityInterface $entity,
    string $operation,
    AccountInterface $account,
  ): AccessResultInterface {
    if (!str_starts_with($entity->getEntityTypeId(), 'bb_')) {
      return AccessResult::neutral();
    }

    return $this->rankEntityFence->check($entity, $operation, $account);
  }

  /**
   * Implements hook_entity_field_access().
   *
   * The field half of Layer B: field gates that re-ask the access handler
   * directly would otherwise read the un-fenced union.
   *
   * This must stay bb_core's ONLY entity_field_access implementation: core
   * merges results per module, so a second one silently replaces this answer.
   * Other field rules join here; the onboarding completion flag is
   * server-controlled and never editable through a form or JSON:API.
   *.
   */
  #[Hook('entity_field_access')]
  public function entityFieldAccess(
    string $operation,
    FieldDefinitionInterface $field_definition,
    AccountInterface $account,
    ?FieldItemListInterface $items = NULL,
  ): AccessResultInterface {
    if ($field_definition->getName() === OnboardingDestination::COMPLETION_FIELD) {
      return $operation === 'edit'
        ? AccessResult::forbidden('Onboarding completion is server-controlled.')
        : AccessResult::neutral();
    }
    if (!str_starts_with($field_definition->getTargetEntityTypeId(), 'bb_')) {
      return AccessResult::neutral();
    }
    $run_log = $this->runLogPolicyFieldAccess($operation, $field_definition);
    if ($run_log !== NULL) {
      return $run_log;
    }

    $saved_row = $this->savedRowFieldPolicy($operation, $field_definition, $account, $items);
    if ($saved_row !== NULL) {
      return $saved_row;
    }

    return $this->rankEntityFence->checkField(
      $operation,
      $field_definition,
      $account,
      $items,
    );
  }

  /**
   * Run-log policy fields: never editable when the deployment disables it.
   *
   * Forbids the workspace opt-in for everyone, admins included, while the
   * operator flag is off, and the computed run policy always. Returns NULL
   * when this rule does not apply.
   */
  private function runLogPolicyFieldAccess(
    string $operation,
    FieldDefinitionInterface $field_definition,
  ): ?AccessResultInterface {
    if ($operation !== 'edit') {
      return NULL;
    }
    $field = $field_definition->getTargetEntityTypeId() . '.' . $field_definition->getName();
    if ($field === 'bb_run.' . RunLogPolicy::RUN_FIELD) {
      return AccessResult::forbidden('The run-log policy is computed.');
    }
    if ($field === 'bb_workspace.' . RunLogPolicy::WORKSPACE_FIELD && !RunLogPolicy::isAvailable()) {
      return AccessResult::forbidden('Run-log storage is disabled by this deployment.');
    }
    return NULL;
  }

  /**
   * Forbids fields outside the saved-row allowlist for ordinary editors.
   *
   * Returns NULL when this rule does not apply, so the rank fence remains
   * the answer for views, unsaved rows, other types and listed fields.
   * Instance admins get a user-contexted Neutral instead of falling through
   * to the fence. An OG group owner is not an instance admin.
   */
  private function savedRowFieldPolicy(
    string $operation,
    FieldDefinitionInterface $field_definition,
    AccountInterface $account,
    ?FieldItemListInterface $items,
  ): ?AccessResultInterface {
    if ($operation !== 'edit' || $items === NULL) {
      return NULL;
    }
    $entity = $items->getEntity();
    if (!$entity instanceof EntityInterface || $entity->isNew()) {
      return NULL;
    }
    $type = $entity->getEntityTypeId();
    if (!isset(self::SAVED_ROW_EDITABLE[$type])) {
      return NULL;
    }
    if ($this->rankCapability->isInstanceAdmin($account)) {
      return AccessResult::neutral()
        ->addCacheContexts(['user', 'user.permissions']);
    }
    if (in_array($field_definition->getName(), self::SAVED_ROW_EDITABLE[$type], TRUE)) {
      return NULL;
    }

    return AccessResult::forbidden('This field is server-maintained.')
      ->addCacheContexts(['user', 'user.permissions'])
      ->addCacheableDependency($entity);
  }

  /**
   * Implements hook_og_user_access_alter().
   *
   * Restores bakers.build's entity permissions on OG group entity types.
   *
   * OG forbids every non-view operation it does not allow itself, which would
   * kill `edit <type>` and the admin permission. Site-wide grants are read
   * from roles, never hasPermission() (that carries the rank union); the rank
   * half is read from the tenancy chain of the group being asked about.
   *.
   *
   * @phpstan-param array<int, string> $permissions
   * @phpstan-param array<string, mixed> $context
   * @phpstan-param-out array<int, string> $permissions
   */
  #[Hook('og_user_access_alter')]
  public function ogUserAccessAlter(
    array &$permissions,
    CacheableMetadata $cacheable_metadata,
    array $context,
  ): void {
    $group = $context['group'] ?? NULL;
    $account = $context['user'] ?? NULL;
    $permission = $context['permission'] ?? NULL;
    $context_is_valid = $group instanceof EntityInterface
      && $account instanceof AccountInterface
      && is_string($permission);
    if (!$context_is_valid) {
      return;
    }
    $entity_type = $group->getEntityType();
    if ($entity_type->getProvider() !== 'bb_core') {
      return;
    }
    // The answer below depends on the account's global permissions and, for the
    // rank half, on its memberships.
    $cacheable_metadata->addCacheContexts(['user.permissions', 'user']);
    $cacheable_metadata->addCacheTags(['og_membership_list']);

    // getAdminPermission() returns FALSE, not NULL, when none is declared.
    $admin_permission = $entity_type->getAdminPermission();
    $has_admin = is_string($admin_permission)
      && $this->rankCapability->hasSiteWidePermission($account, $admin_permission);
    if ($has_admin) {
      $permissions[] = $permission;
      return;
    }

    $entity_type_id = $entity_type->id();
    // The chain includes the group itself, so a project lead is answered by
    // its own project and a workspace lead by the workspace above it.
    $chain = $this->rankEntityFence->groupsAnchoredBy($group);
    $this->mapUpdateAndDeletePermissions($permissions, $account, $chain, $entity_type_id);
  }

  /**
   * Maps the update and delete permissions onto OG's own two group grants.
   *
   * Both `edit <type>` (hand-declared, bb_project only) and the generated
   * `update any <type>` are mapped: the shipped ranks carry the latter for
   * the other group types. `update own <type>` is deliberately not mapped,
   * because holdsPermission() ignores ownership and would widen it to every
   * group of the type.
   *
   * @param array<int, string> $permissions
   *   The permissions to add to, by reference.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account asking.
   * @param array<int, \Drupal\Core\Entity\EntityInterface> $chain
   *   The tenancy chain to check group permissions against.
   * @param string $entity_type_id
   *   The group's entity type id.
   */
  private function mapUpdateAndDeletePermissions(array &$permissions, AccountInterface $account, array $chain, string $entity_type_id): void {
    $may_update = $this->holdsPermission('edit ' . $entity_type_id, $account, $chain)
      || $this->holdsPermission(
        'update any ' . $entity_type_id,
        $account,
        $chain,
      );
    if ($may_update) {
      $permissions[] = OgAccess::UPDATE_GROUP_PERMISSION;
      $permissions[] = 'manage members';
    }
    $may_delete = $this->holdsPermission('delete ' . $entity_type_id, $account, $chain)
      || $this->holdsPermission(
        'delete any ' . $entity_type_id,
        $account,
        $chain,
      );
    if ($may_delete) {
      $permissions[] = OgAccess::DELETE_GROUP_PERMISSION;
    }
  }

  /**
   * Whether the account holds a permission site-wide or anywhere in a chain.
   *
   * @param string $needed
   *   The permission name to look for.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account asking.
   * @param array<int, \Drupal\Core\Entity\EntityInterface> $chain
   *   The tenancy chain to check group permissions against.
   *
   * @return bool
   *   TRUE when the account holds the permission site-wide, or in any group
   *   of the chain.
   */
  private function holdsPermission(
    string $needed,
    AccountInterface $account,
    array $chain,
  ): bool {
    if ($this->rankCapability->hasSiteWidePermission($account, $needed)) {
      return TRUE;
    }
    foreach ($chain as $scope) {
      $held = $this->rankCapability->hasGroupPermission($account, $needed, $scope);
      if ($held) {
        return TRUE;
      }
    }
    return FALSE;
  }

}
