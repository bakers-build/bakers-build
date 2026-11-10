<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workspace;

use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\og\OgRoleInterface;
use Drupal\user\UserInterface;
use Psr\Log\LoggerInterface;

/**
 * Creates a whole workspace in one act, or leaves nothing behind.
 *
 * Workspace, first team and both memberships are saved in one explicit
 * transaction: none is a usable end state alone (a creator without a
 * membership cannot even read their workspace), and per-entity storage
 * transactions commit before insert hooks run. Ownership is `owner_user_id`
 * plus an active `lead` membership; there is no `owner` OG role. The session
 * is not touched here because a session write cannot be rolled back.
 */
final class WorkspaceProvisioner {

  /**
   * The workspace role its creator holds.
   */
  public const WORKSPACE_LEAD_ROLE = 'bb_workspace-bb_workspace-lead';

  /**
   * The workspace role somebody joining by invitation holds.
   */
  public const WORKSPACE_MEMBER_ROLE = 'bb_workspace-bb_workspace-member';

  /**
   * The team role its first member holds.
   */
  public const TEAM_MEMBER_ROLE = 'bb_team-bb_team-member';

  /**
   * The team role its creator holds.
   *
   * The owner's decision: creating a workspace does not just seat the creator
   * as a rank-and-file member of the first team, it puts them in charge of it
   * — the same shape as the workspace side (`WORKSPACE_LEAD_ROLE`), so
   * "you made it, you run it" holds at both levels of the workspace.
   */
  public const TEAM_LEAD_ROLE = 'bb_team-bb_team-lead';

  /**
   * Constructs the provisioner.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entityTypeManager
   *   Creates the workspace, the team and the memberships.
   * @param \Drupal\Core\Database\Connection $database
   *   Carries the one explicit transaction the whole act runs in.
   * @param \Drupal\bb_core\Workspace\WorkspaceSlugDeriver $slugDeriver
   *   Derives the slug, so no customer is asked for one.
   * @param \Psr\Log\LoggerInterface $logger
   *   Records the provisioned workspace and any rollback.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly Connection $database,
    private readonly WorkspaceSlugDeriver $slugDeriver,
    private readonly LoggerInterface $logger,
  ) {}

  /**
   * Provisions a workspace, its first team, and both memberships.
   *
   * @param string $name
   *   The workspace name as typed. The slug is derived from it.
   * @param \Drupal\user\UserInterface $owner
   *   The account that becomes `owner_user_id` and `lead`.
   * @param string $teamName
   *   The first team's name, asked of the customer at workspace creation.
   * @param array<string, mixed> $values
   *   Further optional field values, such as `description` and `image`. They
   *   cannot override the name, the derived slug or the owner.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface
   *   The saved workspace.
   *
   * @throws \Throwable
   *   Rethrown after the rollback, so a caller cannot mistake a failed
   *   provisioning for a successful one. Returning NULL would let a caller
   *   redirect a customer into a workspace that does not exist.
   */
  public function provision(string $name, UserInterface $owner, string $teamName, array $values = []): BbWorkspaceInterface {
    $transaction = $this->database->startTransaction();
    try {
      $workspace = $this->entityTypeManager->getStorage('bb_workspace')->create([
        'name' => $name,
        'slug' => $this->slugDeriver->derive($name),
        'owner_user_id' => $owner->id(),
      ] + $values);
      $workspace->save();
      if (!$workspace instanceof BbWorkspaceInterface) {
        throw new \LogicException('bb_workspace storage returned an unexpected entity type.');
      }

      $team = $this->entityTypeManager->getStorage('bb_team')->create([
        'name' => $teamName,
        'workspace_id' => $workspace->id(),
        'owner_user_id' => $owner->id(),
      ]);
      $team->save();
      if (!$team instanceof ContentEntityInterface) {
        throw new \LogicException('bb_team storage returned an unexpected entity type.');
      }

      // THE WORKSPACE MEMBERSHIP IS VERIFIED, NOT CREATED: `og_entity_insert()`
      // writes it and `WorkspaceMembershipHooks` adds `lead`, so
      // a third write would be a duplicate `OgMembership::preSave()` refuses.
      // That hook is best-effort; asserting here makes it this act's guarantee.
      $this->assertMembership($owner, $workspace, self::WORKSPACE_LEAD_ROLE);

      // THE TEAM MEMBERSHIP IS GRANTED: no hook places a team's creator in
      // `lead`, only in the bare membership `og_entity_insert()` writes, so
      // that membership is upgraded rather than a second one created.
      $this->grantRole($owner, $team, self::TEAM_LEAD_ROLE);
      $this->assertMembership($owner, $team, self::TEAM_LEAD_ROLE);

      $this->logger->notice('Workspace provisioned: %slug with its first team, owned by %name.', [
        '%slug' => $workspace->getSlug(),
        '%name' => $owner->getAccountName(),
      ]);
      return $workspace;
    }
    catch (\Throwable $error) {
      $transaction->rollBack();
      $this->logger->error('Workspace provisioning rolled back for %name: @message', [
        '%name' => $owner->getAccountName(),
        '@message' => $error->getMessage(),
      ]);
      throw $error;
    }
  }

  /**
   * Adds a role to an account's membership on a group, creating it if absent.
   *
   * NEVER `OgMembership::create()` UNCONDITIONALLY: `og_entity_insert()`
   * already wrote a bare membership for the group's owner
   * (`og.module:45-72`), and a second `->save()` for the same
   * account/group pair is a duplicate `OgMembership::preSave()` refuses
   * outright. `Og::getMembership()` finds that existing row so the role is
   * added onto it; only a genuinely absent membership is created fresh.
   *
   * @param \Drupal\user\UserInterface $account
   *   The account to grant the role to.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The workspace or team the membership is on.
   * @param string $roleId
   *   The `og_role` id to add.
   */
  private function grantRole(UserInterface $account, ContentEntityInterface $group, string $roleId): void {
    $role = $this->entityTypeManager->getStorage('og_role')->load($roleId);
    if (!$role instanceof OgRoleInterface) {
      throw new \RuntimeException(sprintf('The og_role %s does not exist.', $roleId));
    }
    $membership = Og::getMembership($group, $account, OgMembershipInterface::ALL_STATES);
    if (!$membership instanceof OgMembershipInterface) {
      $membership = OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT]);
      $membership->setOwner($account)->setGroup($group);
    }
    $membership->setState(OgMembershipInterface::STATE_ACTIVE)->addRole($role)->save();
  }

  /**
   * Throws unless this account holds an active membership carrying this role.
   *
   * READS `getRoles()` AND NOT `getRolesIds()`, and the difference decides
   * whether this method is correct. `OgMembership::getRoles()` prepends the
   * group's AUTHENTICATED role whenever a group is set
   * (`OgMembership.php:341-353`) — the required `member` role every
   * membership carries beside whatever was explicitly stored, `lead`
   * included. That prepended role is never STORED on the membership, so
   * asserting the stored ids alone would miss it; the effective role set is
   * the thing the requirement is actually about.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account whose membership is required.
   * @param \Drupal\Core\Entity\EntityInterface $group
   *   The workspace or team the membership must be on.
   * @param string $roleId
   *   The `og_role` id the membership must carry.
   */
  private function assertMembership(AccountInterface $account, EntityInterface $group, string $roleId): void {
    $ids = $this->entityTypeManager->getStorage('og_membership')->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', $group->getEntityTypeId())
      ->condition('entity_id', (string) $group->id())
      ->condition('uid', (string) $account->id())
      ->condition('state', OgMembershipInterface::STATE_ACTIVE)
      ->range(0, 1)
      ->execute();
    $membership = $ids === []
      ? NULL
      : $this->entityTypeManager->getStorage('og_membership')->load(reset($ids));
    if (!$membership instanceof OgMembershipInterface) {
      throw new \RuntimeException(sprintf(
        'No active %s membership was provisioned for uid %s on %s.',
        $group->getEntityTypeId(),
        $account->id(),
        $group->id(),
      ));
    }
    $effective = array_map(static fn ($role) => $role->id(), $membership->getRoles());
    if (!in_array($roleId, $effective, TRUE)) {
      throw new \RuntimeException(sprintf(
        'The %s membership for uid %s carries [%s] and not the required %s.',
        $group->getEntityTypeId(),
        $account->id(),
        implode(',', $effective),
        $roleId,
      ));
    }
  }

  /**
   * Writes one active membership carrying one role.
   *
   * THE ROLE IS SET BY ID rather than by loading an `OgRole` entity, because
   * `OgMembership::addRole()` takes the entity and `setRoles()` takes a list of
   * them — and the ten roles this product ships are config entities whose ids
   * are stated in `recipes/bakers/recipe.yml` by name. Loading by id keeps the
   * failure honest: a renamed role fails here, loudly, instead of writing a
   * membership with no role at all.
   *
   * THE PARAMETER TYPES ARE OG'S, NOT THE WIDEST THAT WOULD COMPILE.
   * `setOwner()` takes a `UserInterface` and `setGroup()` a
   * `ContentEntityInterface`, so accepting `AccountInterface` and
   * `EntityInterface` here would move two type errors from this signature into
   * OG's — where they would only surface at runtime, on a save.
   *
   * @param \Drupal\user\UserInterface $account
   *   The member.
   * @param \Drupal\Core\Entity\ContentEntityInterface $group
   *   The workspace or team to join.
   * @param string $roleId
   *   The `og_role` id the membership carries.
   */
  public function addMembership(UserInterface $account, ContentEntityInterface $group, string $roleId): void {
    $role = $this->entityTypeManager->getStorage('og_role')->load($roleId);
    if (!$role instanceof OgRoleInterface) {
      throw new \RuntimeException(sprintf('The og_role %s does not exist.', $roleId));
    }
    $membership = OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT]);
    $membership
      ->setOwner($account)
      ->setGroup($group)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->addRole($role)
      ->save();
  }

  /**
   * Whether this account already holds a membership on this group.
   *
   * Used by the join path, where a second membership for one account would be
   * accepted by the storage and would render as a duplicate row — the same
   * refusal `GroupMemberAddForm` makes for the same reason.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The account to check.
   * @param \Drupal\Core\Entity\EntityInterface $group
   *   The group to check.
   *
   * @return bool
   *   TRUE when a membership already exists.
   */
  public function isMember(AccountInterface $account, EntityInterface $group): bool {
    $existing = $this->entityTypeManager->getStorage('og_membership')->getQuery()
      ->accessCheck(FALSE)
      ->condition('entity_type', $group->getEntityTypeId())
      ->condition('entity_id', (string) $group->id())
      ->condition('uid', (string) $account->id())
      ->range(0, 1)
      ->execute();
    return $existing !== [];
  }

}
