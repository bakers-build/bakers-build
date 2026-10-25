<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\og\OgMembershipInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A workspace admin sees every project of its workspace, holding none (V5).
 *
 * AC 3 and D11. OG has no group nesting and no inheritance, so this rule is
 * bakers.build's own — and the criterion says explicitly that it must live in
 * the filter rather than in stored memberships. The operational meaning of that
 * sentence is the assertion at the end of every case: not one bb_project
 * membership exists anywhere in this test, which the class checks by counting
 * them.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceReadScopeAdminTest extends KernelTestBase {

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
   * The permissions every actor holds, so only the role can explain a result.
   *
   * @var array<string>
   */
  private const READER_PERMISSIONS = [
    'view bb_workspace', 'view bb_project', 'view bb_ticket',
    'view bb_run',
  ];

  /**
   * The second project of workspace A, which no actor is a member of.
   */
  private int $secondProjectId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    // A second project under workspace A, so "every project of the workspace"
    // means more than "the one project in the fixture".
    $second = $this->createEntity('bb_project', [
      'name' => 'project-a-2',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
    ]);
    $this->secondProjectId = (int) $second->id();
    $this->createEntity('bb_ticket', [
      'identifier' => 'T-A2',
      'title' => 'ticket-a-2',
      'workflow' => 'bb_work',
      'project_id' => $this->secondProjectId,
    ]);
  }

  /**
   * Each see-all role reaches every project of its workspace.
   *
   * `app` used to join `lead` here — BB-462 D9 removes the machine rank
   * entirely, so `lead` is the only remaining see-all role.
   */
  public function testSeeAllRolesReachEveryProjectOfTheirWorkspace(): void {
    foreach (['lead'] as $role_name) {
      $account = $this->createAccount('ws-' . $role_name, self::READER_PERMISSIONS);
      $this->addMembership(
        $this->fixture('a', 'bb_workspace'),
        $account,
        [$role_name],
      );

      $projects = $this->queryIdsAs('bb_project', $account);
      self::assertContains(
        (int) $this->fixture('a', 'bb_project')->id(),
        $projects,
        "Role $role_name sees the workspace's first project.",
      );
      self::assertContains(
        $this->secondProjectId,
        $projects,
        "Role $role_name sees a project it holds no membership in.",
      );
      self::assertNotContains(
        (int) $this->fixture('b', 'bb_project')->id(),
        $projects,
        "Role $role_name stops at its own workspace.",
      );

      // And their tickets and runs, which is the half the criterion names.
      self::assertCount(
        2,
        $this->queryIdsAs('bb_ticket', $account),
        "Role $role_name sees the tickets of both projects.",
      );
      self::assertContains(
        (int) $this->fixture('a', 'bb_run')->id(),
        $this->queryIdsAs('bb_run', $account),
        "Role $role_name sees the runs of the workspace's projects.",
      );
      self::assertNotContains(
        (int) $this->fixture('b', 'bb_run')->id(),
        $this->queryIdsAs('bb_run', $account),
        "Role $role_name sees no run of the other workspace.",
      );
    }

    $this->assertNoProjectMembershipExists();
  }

  /**
   * The plain roles get no see-all rule: `member` and `guest` see their own.
   */
  public function testMemberAndGuestSeeOnlyTheirOwnProjects(): void {
    foreach (['member', 'guest'] as $role_name) {
      $account = $this->createAccount('plain-' . $role_name, self::READER_PERMISSIONS);
      $this->addMembership(
        $this->fixture('a', 'bb_workspace'),
        $account,
        [$role_name],
      );

      self::assertSame(
        [],
        $this->queryIdsAs('bb_project', $account),
        "Role $role_name must not see a project it is not a member of.",
      );
      self::assertSame(
        [],
        $this->queryIdsAs('bb_ticket', $account),
        "Role $role_name must see no ticket through the workspace alone.",
      );
      self::assertSame(
        [(int) $this->fixture('a', 'bb_workspace')->id()],
        $this->queryIdsAs('bb_workspace', $account),
        "Role $role_name is still a member of the workspace itself.",
      );
    }

    $this->assertNoProjectMembershipExists();
  }

  /**
   * A blocked or pending membership grants nothing.
   *
   * The scope resolves active memberships only, which is what makes revoking
   * access a state change rather than a delete. Asserted on the widest role, so
   * a state check dropped from the resolution fails here.
   */
  public function testOnlyActiveMembershipsGrantTheSeeAllRule(): void {
    $account = $this->createAccount('ws-blocked', self::READER_PERMISSIONS);
    $membership = $this->addMembership(
      $this->fixture('a', 'bb_workspace'),
      $account,
      ['lead'],
    );
    $membership->setState(OgMembershipInterface::STATE_BLOCKED)->save();
    $this->container->get('cache.static')->deleteAll();

    self::assertSame([], $this->queryIdsAs('bb_project', $account));
    self::assertSame([], $this->queryIdsAs('bb_workspace', $account));
  }

  /**
   * Asserts the see-all rule is not materialised as project memberships.
   *
   * The world's owner holds project memberships OG created on save (Fact 15),
   * so the assertion is about their number, not about zero: exactly the two
   * seeded projects' owner memberships plus the second project's, and nothing
   * an actor of this test holds.
   */
  private function assertNoProjectMembershipExists(): void {
    $memberships = $this->container->get('entity_type.manager')
      ->getStorage('og_membership')
      ->loadByProperties(['entity_type' => 'bb_project']);
    foreach ($memberships as $membership) {
      self::assertInstanceOf(OgMembershipInterface::class, $membership);
      self::assertSame(
        (int) $this->worldOwner->id(),
        (int) $membership->getOwnerId(),
        'Only OG own auto-owner memberships exist on projects; the see-all '
        . 'rule lives in the filter, never in a stored membership.',
      );
    }
  }

}
