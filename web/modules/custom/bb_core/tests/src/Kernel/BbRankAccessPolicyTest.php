<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A rank grants its permissions to an account that holds no product role.
 *
 * This is Layer A of BB-359 D1 — the boundary where a rank becomes a
 * permission, and the only place where "and nothing more" is assertable at
 * all. Every actor here holds a dedicated empty user_role and nothing else, so
 * a TRUE answer can only come from the membership.
 *
 * The assertions go through `hasPermission()` rather than through the policy
 * service, deliberately: `User::hasPermission()` routes through
 * `permission_checker` → `AccessPolicyProcessor`, which is the seam every
 * existing consumer (EntityPermissionProvider, QueryAccessHandlerBase, route
 * `_permission`, JSON:API) reads. Asserting on the service would prove the
 * service, not the integration.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbRankAccessPolicyTest extends KernelTestBase {

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
   * A workspace `contributor` rank grants exactly the contributor set.
   *
   * Rewritten from `member` (BB-462 D1, D2): the implicit member rank is
   * emptied entirely — OG ranks are additive and cannot be narrowed, so any
   * right left there would be inherited by every membership including guests
   * — and the base creation rights this test used to pin move onto the new,
   * explicitly stored `contributor` rank instead.
   */
  public function testWorkspaceContributorRankGrantsItsPermissions(): void {
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'Acme',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $account = $this->createAccount('rank-only');
    $this->addMembership($workspace, $account, ['contributor']);

    self::assertTrue(
      $account->hasPermission('view bb_ticket'),
      'the contributor rank grants view bb_ticket',
    );
    self::assertTrue(
      $account->hasPermission('create bb_ticket'),
      'the contributor rank grants create bb_ticket',
    );
    self::assertTrue(
      $account->hasPermission('create bb_project'),
      'the contributor rank grants create bb_project (BB-462 D2)',
    );
    self::assertFalse(
      $account->hasPermission('edit bb_project'),
      'the contributor rank does not grant edit bb_project — that moved to '
      . 'bb_team-bb_team-lead in BB-454 round 4, not to the workspace',
    );
    self::assertFalse(
      $account->hasPermission('delete bb_project'),
      'the contributor rank does not grant delete bb_project, for the same reason',
    );
    self::assertFalse(
      $account->hasPermission('administer bakers'),
      'no rank grants administer bakers; uid 1 stays the only bypass (D6)',
    );
  }

  /**
   * A team `lead` rank grants edit/delete of the projects it holds.
   *
   * Moved here from `bb_workspace-bb_workspace-contributor` (BB-454
   * round 4 review): a project's edit/delete rights belong to the team that
   * carries visibility over it, not to the workspace, which carries rights
   * but no membership relationship to any one project.
   */
  public function testTeamLeadRankGrantsEditAndDeleteBbProject(): void {
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'Acme',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $team = $this->createEntity('bb_team', [
      'name' => 'Acme Team',
      'workspace_id' => $workspace->id(),
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $account = $this->createAccount('rank-team-lead');
    $this->addMembership($team, $account, ['lead']);

    self::assertTrue(
      $account->hasPermission('edit bb_project'),
      'the team lead rank grants edit bb_project (BB-454 round 4)',
    );
    self::assertTrue(
      $account->hasPermission('delete bb_project'),
      'the team lead rank grants delete bb_project (BB-454 round 4)',
    );
  }

  /**
   * The implicit workspace `member` rank grants nothing at all (BB-462 D1).
   *
   * The decision that carries the rest of BB-462: OG's `member` role is
   * unconditionally re-added by `OgMembership::getRoles()` to every
   * membership, additively, with no way to narrow it back off. So long as any
   * right sat here, every membership — including a guest's — held at least
   * that right. Emptying it is what makes "guests may not create projects"
   * buildable at all.
   */
  public function testWorkspaceMemberRankGrantsNothing(): void {
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'Acme',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $account = $this->createAccount('rank-none');
    $this->addMembership($workspace, $account, []);

    self::assertFalse(
      $account->hasPermission('view bb_ticket'),
      'a membership with no explicit role grants view bb_ticket to nobody',
    );
    self::assertFalse(
      $account->hasPermission('create bb_ticket'),
      'a membership with no explicit role grants create bb_ticket to nobody',
    );
  }

  /**
   * A workspace `lead` rank grants the administering set the member lacks.
   */
  public function testWorkspaceLeadRankGrantsTheAdministeringSet(): void {
    $workspace = $this->createEntity('bb_workspace', [
      'name' => 'Acme',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $account = $this->createAccount('rank-lead');
    $this->addMembership($workspace, $account, ['lead']);

    self::assertTrue($account->hasPermission('edit bb_project'));
    self::assertTrue($account->hasPermission('create bb_project'));
    self::assertFalse($account->hasPermission('assign bakers conductor'));
    self::assertFalse(
      $account->hasPermission('administer bakers'),
      'lead administers its workspace, not the instance',
    );
    self::assertFalse(
      $account->hasPermission('create bb_workspace'),
      'creating a tenancy is an instance act and stays off every rank (D3)',
    );
  }

  /**
   * An account with no membership gets nothing from this policy.
   */
  public function testNoMembershipGrantsNothing(): void {
    $account = $this->createAccount('outsider');

    self::assertFalse($account->hasPermission('view bb_ticket'));
    self::assertFalse($account->hasPermission('access bakers dashboard'));
  }

}
