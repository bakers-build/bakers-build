<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A group's owner holds the `lead` rank, not a bare membership (D13).
 *
 * `og.settings` carries `auto_add_group_owner_membership: true`, and the
 * membership OG creates is bare — the implicit `member` and nothing else.
 * Left alone, a workspace owner would hold MEMBER capability everywhere
 * Layer A is consulted (the dashboard, every list, every JSON:API collection)
 * while `group_manager_full_access: true` waved them through on any single
 * entity. Two sources answering differently about the same person, which is
 * exactly the divergence BB-359 exists to remove.
 *
 * The same file also explains why the assertions here are worth making at all:
 * OgAccess allows the owner ANY permission before a role is read, so an
 * OgAccess-based assertion would pass with or without the placement. These
 * assertions therefore go through the membership's roles and through Layer A.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class GroupOwnerLeadPlacementTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
  }

  /**
   * A workspace owner is placed in the workspace's `lead` rank.
   */
  public function testWorkspaceOwnerHoldsTheLeadRank(): void {
    $owner = $this->createAccount('tenant-owner');
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'Acme',
      'owner_user_id' => $owner->id(),
    ]);

    $membership = Og::getMembership($workspace, $owner, [OgMembershipInterface::STATE_ACTIVE]);
    self::assertNotNull($membership, 'auto_add_group_owner_membership gives the owner a membership');
    self::assertContains(
      'bb_workspace-bb_workspace-lead',
      $membership->getRolesIds(),
      'and D13 makes it a lead membership, not a bare member one',
    );
    // The point of D13 is what Layer A then sees.
    self::assertTrue($owner->hasPermission('create bb_project'));
  }

  /*
   * testProjectOwnerHoldsTheLeadRank() is GONE (BB-462 D7):
   * bb_core_bb_project_insert() and its owner→lead placement are
   * removed along with bb_project's OG group registration — a project
   * owner has no membership of any kind to be placed into any more.
   */

  /**
   * Re-saving the group does not create a second membership.
   */
  public function testPlacementIsIdempotent(): void {
    $owner = $this->createAccount('tenant-owner');
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'Acme',
      'owner_user_id' => $owner->id(),
    ]);
    $workspace->set('name', 'Acme renamed');
    $workspace->save();

    $memberships = $this->container->get('entity_type.manager')
      ->getStorage('og_membership')
      ->loadByProperties([
        'entity_type' => 'bb_workspace',
        'entity_id' => $workspace->id(),
        'uid' => $owner->id(),
      ]);
    self::assertCount(1, $memberships, 'one membership, not one per save');
    $membership = reset($memberships);
    self::assertInstanceOf(OgMembershipInterface::class, $membership);
    self::assertSame(
      ['bb_workspace-bb_workspace-lead'],
      array_values(array_diff($membership->getRolesIds(), ['bb_workspace-bb_workspace-member'])),
      'and exactly one lead role on it',
    );
  }

  /**
   * A missing `lead` rank is logged and skipped, never raised.
   *
   * The reachable failure mode, and the reason the placement is best-effort:
   * between `updatedb` and `config:import` a deployed site can hold data whose
   * rank config CIM has not created yet. Saving a group must not fail there.
   * (An ownerless group is not the failure mode to test — `owner_user_id` is
   * NOT NULL on bb_workspace, so it cannot be saved at all.)
   */
  public function testMissingRankIsSkippedRatherThanRaised(): void {
    $role = $this->container->get('entity_type.manager')->getStorage('og_role')
      ->load('bb_workspace-bb_workspace-lead');
    self::assertNotNull($role);
    $role->delete();

    $owner = $this->createAccount('tenant-owner');
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'Acme',
      'owner_user_id' => $owner->id(),
    ]);

    self::assertNotNull($workspace->id(), 'the group saves even with no rank to place into');
    $membership = Og::getMembership($workspace, $owner, [OgMembershipInterface::STATE_ACTIVE]);
    self::assertNotNull($membership, 'OG still auto-adds the bare owner membership');
    self::assertNotContains('bb_workspace-bb_workspace-lead', $membership->getRolesIds());
  }

}
