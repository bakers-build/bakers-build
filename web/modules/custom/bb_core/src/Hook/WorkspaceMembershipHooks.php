<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityLastInstalledSchemaRepositoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspace;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\Core\TypedData\TypedDataManagerInterface;
use Drupal\user\EntityOwnerInterface;
use Drupal\user\UserInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Entity-hooks for workspaces, conductors and OG memberships.
 *
 * Grouped together because every hook here reacts to a WRITE of one of
 * bb_core's tenancy-carrying entities — a workspace being created, a
 * conductor being placed, a membership changing — rather than to a read or an
 * access decision.
 */
final class WorkspaceMembershipHooks {

  public function __construct(
    #[Autowire(service: 'logger.channel.bb_core')]
    private readonly LoggerInterface $logger,
    #[Autowire(service: 'bb_core.workspace_read_scope')]
    private readonly BbWorkspaceReadScopeInterface $readScope,
    #[Autowire(service: 'typed_data_manager')]
    private readonly TypedDataManagerInterface $typedDataManager,
    #[Autowire(service: 'entity_type.manager')]
    private readonly EntityTypeManagerInterface $entityTypeManager,
    #[Autowire(service: 'entity.last_installed_schema.repository')]
    private readonly EntityLastInstalledSchemaRepositoryInterface $installedSchema,
  ) {
  }

  /**
   * Implements hook_ENTITY_TYPE_insert() for bb_workspace.
   *
   * Places the workspace's owner in its `lead` rank.
   */
  #[Hook('bb_workspace_insert')]
  public function bakersWorkspaceInsert(EntityInterface $workspace): void {
    $this->placeGroupOwnerInLead($workspace);
  }

  /**
   * Implements hook_ENTITY_TYPE_insert() for og_role.
   */
  #[Hook('og_role_insert')]
  public function ogRoleInsert(OgRole $role): void {
    if ($role->id() === 'bb_workspace-bb_workspace-lead') {
      $this->placeDefaultWorkspaceOwnerInLead();
    }
  }

  /**
   * Places the default workspace's owner in `lead` once rank and group exist.
   *
   * Recipe and existing-config installs create the default workspace in
   * hook_install(), before the `lead` rank is imported and, on the recipe
   * path, before the recipe registers the group. Called when either arrives;
   * the call that finds both does the placing.
   */
  public function placeDefaultWorkspaceOwnerInLead(): void {
    // Kernel tests may create OG config without the workspace table.
    if ($this->installedSchema->getLastInstalledDefinition('bb_workspace') === NULL) {
      return;
    }
    if (!Og::isGroup('bb_workspace', 'bb_workspace') || OgRole::load('bb_workspace-bb_workspace-lead') === NULL) {
      return;
    }
    $matches = $this->entityTypeManager->getStorage('bb_workspace')
      ->loadByProperties(['uuid' => BbWorkspace::DEFAULT_UUID]);
    $workspace = reset($matches);
    if ($workspace instanceof EntityOwnerInterface) {
      $this->placeGroupOwnerInLead($workspace);
      // This runs mid-install; a later install step must load the owner with
      // the fields imported after this point.
      $this->entityTypeManager->getStorage('user')->resetCache([$workspace->getOwnerId()]);
    }
  }

  /**
   * Places a group's owner in the group's `lead` rank.
   *
   * OG's automatic owner membership is bare (`member` only); with
   * `group_manager_full_access` off, the lead seat is where the owner's rights
   * come from. Insert
   * only; re-owning is out of scope. Failures are logged, not raised: a
   * deployed site passes through a missing rank config between `updatedb` and
   * `config:import`.
   *
   * @param \Drupal\Core\Entity\EntityInterface $group
   *   The saved bb_workspace.
   */
  private function placeGroupOwnerInLead(EntityInterface $group): void {
    if (!$group instanceof EntityOwnerInterface) {
      return;
    }
    // The rank is checked before the owner loads: during an install the user
    // fields may not exist yet, and a cached owner would keep that state.
    $group_type = $group->getEntityTypeId();
    $role = OgRole::load("$group_type-$group_type-lead");
    if ($role === NULL) {
      $this->logger->warning('The @type `lead` role is missing; the owner of @id was not placed.', [
        '@type' => $group_type,
        '@id' => $group->id(),
      ]);
      return;
    }

    $account = $group->getOwner();
    if (!$account instanceof UserInterface) {
      $this->logger->info('Group @type @id has no owner account; no lead placement.', [
        '@type' => $group->getEntityTypeId(),
        '@id' => $group->id(),
      ]);
      return;
    }

    try {
      $membership = Og::getMembership($group, $account, OgMembershipInterface::ALL_STATES)
        ?? Og::createMembership($group, $account);
      if (in_array($role->id(), $membership->getRolesIds(), TRUE)) {
        // Already placed — idempotent, so nothing to write.
        return;
      }
      $membership->addRole($role)->save();
    }
    catch (\Exception $e) {
      $this->logger->warning('Could not place the owner of @type @id in its lead rank: @message', [
        '@type' => $group_type,
        '@id' => $group->id(),
        '@message' => $e->getMessage(),
      ]);
    }
  }

  /**
   * Implements hook_ENTITY_TYPE_insert() for bb_conductor.
   */
  #[Hook('bb_conductor_insert')]
  public function bakersConductorInsert(BbConductorInterface $conductor): void {
    $this->logConductorOwnerVisibilityMismatch($conductor);
  }

  /**
   * Implements hook_ENTITY_TYPE_update() for bb_conductor.
   *
   * Re-run on every update, not only on insert: a conductor re-pointed at
   * another project must be re-checked against its owner's visibility of THAT
   * project — the assignment that was fine yesterday can be outside the
   * owner's teams today.
   */
  #[Hook('bb_conductor_update')]
  public function bakersConductorUpdate(BbConductorInterface $conductor): void {
    $this->logConductorOwnerVisibilityMismatch($conductor);
  }

  /**
   * Logs, loudly, a conductor assigned outside its owning user's visibility.
   *
   * A conductor sees exactly what its owning user sees, so a project the owner
   * cannot see makes every read come back empty at HTTP 200. That is logged at
   * ERROR rather than refused, so either half of the fix can still be saved.
   * Ownerless or projectless conductors are half-built records and stay
   * silent; an unset owner resolves to the anonymous user, hence the second
   * guard.
   *
   * @param \Drupal\bb_core\Entity\BbConductorInterface $conductor
   *   The conductor being saved.
   */
  private function logConductorOwnerVisibilityMismatch(BbConductorInterface $conductor): void {
    $account = $conductor->get('owner_user_id')->entity;
    if (!$account instanceof UserInterface || $account->isAnonymous()) {
      return;
    }
    $project = $conductor->get('project_id')->entity;
    if (!$project instanceof BbProjectInterface) {
      return;
    }

    if ($this->readScope->isBypassed($account, 'bb_project')) {
      return;
    }
    if (in_array((int) $project->id(), $this->readScope->projectIds($account), TRUE)) {
      return;
    }

    $this->logger->error(
      'Conductor @conductor is assigned to project @project (@label), which its owning user '
      . '@name (uid @uid) cannot see. The owner must belong to one of the project\'s teams, or '
      . 'hold the workspace admin rank, or every read this conductor issues as that owner will '
      . 'silently return empty.',
      [
        '@conductor' => $conductor->id() ?? 'new',
        '@project' => $project->id(),
        '@label' => $project->label(),
        '@name' => $account->getAccountName(),
        '@uid' => $account->id(),
      ],
    );
  }

  /**
   * Implements hook_ENTITY_TYPE_insert() for og_membership.
   */
  #[Hook('og_membership_insert')]
  public function ogMembershipInsert(EntityInterface $membership): void {
    $this->forgetReadScope($membership);
  }

  /**
   * Implements hook_ENTITY_TYPE_update() for og_membership.
   */
  #[Hook('og_membership_update')]
  public function ogMembershipUpdate(EntityInterface $membership): void {
    $this->forgetReadScope($membership);
  }

  /**
   * Implements hook_ENTITY_TYPE_delete() for og_membership.
   */
  #[Hook('og_membership_delete')]
  public function ogMembershipDelete(EntityInterface $membership): void {
    $this->forgetReadScope($membership);
    if ($membership instanceof OgMembershipInterface && $membership->getGroupEntityType() === 'bb_workspace') {
      $this->endTeamSeats((int) $membership->getGroupId(), (int) $membership->getOwnerId());
    }
  }

  /**
   * Deletes a person's team memberships in one workspace.
   *
   * A team seat outlives the workspace seat otherwise and keeps the rank's
   * rights on the workspace's projects.
   *
   * @param int $workspace_id
   *   The workspace the person left.
   * @param int $uid
   *   The person.
   */
  private function endTeamSeats(int $workspace_id, int $uid): void {
    $team_ids = $this->entityTypeManager->getStorage('bb_team')->getQuery()
      ->accessCheck(FALSE)
      ->condition('workspace_id', $workspace_id)
      ->execute();
    if (!$team_ids) {
      return;
    }
    $storage = $this->entityTypeManager->getStorage('og_membership');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', 'bb_team')
      ->condition('entity_id', array_values($team_ids), 'IN')
      ->condition('uid', $uid)
      ->execute();
    if ($ids) {
      $storage->delete($storage->loadMultiple($ids));
    }
  }

  /**
   * Drops the read-scope memo of the account whose membership just changed.
   *
   * OG's own upsert resolves the read scope before writing, so without this
   * the rest of the request reads a stale, empty scope. Scoped to the one
   * account whose memberships changed.
   *
   * @param \Drupal\Core\Entity\EntityInterface $membership
   *   The membership that was written or removed.
   */
  private function forgetReadScope(EntityInterface $membership): void {
    if (!$membership instanceof OgMembershipInterface) {
      return;
    }
    $this->readScope->reset((int) $membership->getOwnerId());
  }

  /**
   * Implements hook_entity_bundle_create().
   *
   * Makes a freshly created og_membership bundle discoverable as typed data.
   *
   * TypedDataManager caches definitions without a bundle cache tag, so a
   * membership created in the request that installed og fails validation.
   *.
   *
   * @param string $entity_type_id
   *   The entity type the bundle belongs to.
   * @param string $bundle
   *   The bundle that was created, unused: og_membership has exactly one, so
   *   only the entity type id decides whether this fires. The hook's own
   *   signature still requires the parameter.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  #[Hook('entity_bundle_create')]
  public function entityBundleCreate(string $entity_type_id, string $bundle): void {
    if ($entity_type_id !== 'og_membership') {
      return;
    }
    $this->typedDataManager->clearCachedDefinitions();
  }

}
