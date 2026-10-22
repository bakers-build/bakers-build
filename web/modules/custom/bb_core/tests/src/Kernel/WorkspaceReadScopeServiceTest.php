<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Access\BbWorkspaceReadScopeInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The read scope resolves workspace, project and people id sets from OG.
 *
 * Spec D3/D4/D11. The interesting half is what OG cannot answer: it has no
 * group nesting, so "a workspace admin sees every project of that workspace" is
 * bakers.build's own rule and is resolved here as an entity query whose
 * *result* goes into the filter — never as a traversal written into the
 * condition, which ViewsQueryAlter would silently map onto the wrong column
 * (Fact 6, D4).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceReadScopeServiceTest extends KernelTestBase {

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
    $this->buildTwoWorkspaceWorld();
  }

  /**
   * Returns the service under test.
   *
   * @return \Drupal\bb_core\Access\BbWorkspaceReadScopeInterface
   *   The read scope resolver.
   */
  private function scope(): BbWorkspaceReadScopeInterface {
    $scope = $this->container->get('bb_core.workspace_read_scope');
    self::assertInstanceOf(BbWorkspaceReadScopeInterface::class, $scope);
    return $scope;
  }

  /**
   * A plain member resolves exactly the groups it holds a membership in.
   */
  public function testPlainMemberResolvesItsOwnGroupsOnly(): void {
    $account = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    self::assertSame(
      [(int) $this->fixture('a', 'bb_workspace')->id()],
      $this->scope()->workspaceIds($account),
    );
    self::assertSame(
      [(int) $this->fixture('a', 'bb_project')->id()],
      $this->scope()->projectIds($account),
    );
  }

  /**
   * A workspace admin resolves every project of that workspace, holding none.
   *
   * The membership the test writes is a workspace membership carrying the
   * `lead` rank; no bb_project membership is created anywhere. That is what
   * "a rule in the filter, not materialised memberships" means operationally
   * (D4), and it is the only assertion that distinguishes the two.
   */
  public function testWorkspaceLeadResolvesEveryProjectOfItsWorkspace(): void {
    $account = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['lead']);
    // A second project under the same workspace, to show the rule is not just
    // "the one project" but the workspace's whole set.
    $second = $this->createEntity('bb_project', [
      'name' => 'project-a-2',
      'group_id' => $this->fixture('a', 'bb_group')->id(),
    ]);

    $expected = [
      (int) $this->fixture('a', 'bb_project')->id(),
      (int) $second->id(),
    ];
    $resolved = $this->scope()->projectIds($account);
    sort($expected);
    sort($resolved);
    self::assertSame($expected, $resolved);
    self::assertNotContains(
      (int) $this->fixture('b', 'bb_project')->id(),
      $resolved,
      'The lead rule stops at its own workspace.',
    );
  }

  /**
   * Lead sees every project; member and guest do not (BB-462 D9).
   *
   * D11's operator decision, asserted in both directions in one place so the
   * role set cannot quietly grow or shrink. `app` used to join `lead` here —
   * BB-462 D9 removes the machine rank entirely, so `lead` is the only
   * remaining see-all role.
   */
  public function testOnlyLeadSeesEveryProject(): void {
    $workspace = $this->fixture('a', 'bb_workspace');
    $project_id = (int) $this->fixture('a', 'bb_project')->id();

    foreach (['lead'] as $role_name) {
      $account = $this->createAccount('sees-all-' . $role_name);
      $this->addMembership($workspace, $account, [$role_name]);
      self::assertSame(
        [$project_id],
        $this->scope()->projectIds($account),
        "Role $role_name must see the workspace's projects.",
      );
    }

    foreach (['member', 'guest'] as $role_name) {
      $account = $this->createAccount('sees-none-' . $role_name);
      $this->addMembership($workspace, $account, [$role_name]);
      self::assertSame(
        [],
        $this->scope()->projectIds($account),
        "Role $role_name must see no project it is not a member of.",
      );
      self::assertSame(
        [(int) $workspace->id()],
        $this->scope()->workspaceIds($account),
        "Role $role_name is still a member of the workspace itself.",
      );
    }
  }

  /**
   * An account with no membership resolves two empty sets.
   */
  public function testNoMembershipResolvesEmptySets(): void {
    $stranger = $this->createAccount('scope-stranger');

    self::assertSame([], $this->scope()->workspaceIds($stranger));
    self::assertSame([], $this->scope()->projectIds($stranger));
  }

  /**
   * Team membership alone grants project/ticket visibility now (BB-462 D4).
   *
   * Rewritten from `testTeamOnlyMemberSeesNoProjectsOrTickets`, which pinned
   * the BB-321 finding that a team is "reporting-only" — BB-462 overturns
   * that by design: a project is visible exactly to the members of a team it
   * names, so team membership is now the primary source, not a rejected third
   * one. Workspace membership without any team membership sees nothing, which
   * is the negative control this rewrite keeps.
   */
  public function testTeamOnlyMemberSeesProjectsAndTicketsOfItsTeam(): void {
    $account = $this->createAccount('team-only', [
      'view bb_project',
      'view bb_ticket',
    ]);
    $this->addMembership($this->fixture('a', 'bb_team'), $account, []);

    self::assertSame(
      [(int) $this->fixture('a', 'bb_project')->id()],
      $this->scope()->projectIds($account),
      'A team member sees the projects of its team.',
    );
    self::assertContains(
      (int) $this->fixture('a', 'bb_ticket')->id(),
      $this->queryIdsAs('bb_ticket', $account),
      'A team-only member sees its team project\'s tickets.',
    );

    // Negative control: workspace membership alone, without any team, sees
    // neither the project nor its tickets (BB-462 D1: `member` is emptied).
    $workspace_only = $this->createAccount('workspace-only-control', [
      'view bb_project', 'view bb_ticket',
    ]);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $workspace_only, ['member']);
    self::assertSame(
      [],
      $this->scope()->projectIds($workspace_only),
      'Workspace membership alone is not a projectIds source.',
    );
    self::assertSame(
      [],
      $this->queryIdsAs('bb_ticket', $workspace_only),
      'A workspace-only member sees zero tickets via accessCheck(TRUE).',
    );
  }

  /**
   * The people set holds the account itself plus its workspaces' members.
   *
   * The account's own id is not a courtesy: a person who cannot see themselves
   * breaks their own profile, author rendering and every include that resolves
   * back to them (D5).
   */
  public function testPeopleSetHoldsTheAccountAndItsWorkspacePeers(): void {
    $account = $this->member('a');
    $peer = $this->createAccount('peer-a');
    $outsider = $this->member('b');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $peer, ['member']);
    $this->addMembership($this->fixture('b', 'bb_workspace'), $outsider, ['member']);

    $people = $this->scope()->peopleIds($account);
    self::assertContains((int) $account->id(), $people);
    self::assertContains((int) $peer->id(), $people);
    self::assertNotContains((int) $outsider->id(), $people);
  }

  /**
   * An account with no membership still resolves itself as visible people.
   */
  public function testPeopleSetNeverEmptiesForAnAuthenticatedAccount(): void {
    $stranger = $this->createAccount('people-stranger');

    self::assertSame([(int) $stranger->id()], $this->scope()->peopleIds($stranger));
  }

  /**
   * The bypass question is answered by the permission, never by a group shape.
   *
   * Fact 3: buildConditions() returns an empty group both for a holder of
   * `administer bakers` and for a holder of `view bb_ticket`, so reading the
   * shape cannot tell full access from permission-derived access.
   */
  public function testBypassIsDecidedByTheAdminPermission(): void {
    $admin = $this->createAccount('scope-admin', ['administer bakers']);
    $reader = $this->createAccount('scope-reader', ['view bb_ticket']);

    self::assertTrue($this->scope()->isBypassed($admin, 'bb_ticket'));
    self::assertFalse($this->scope()->isBypassed($reader, 'bb_ticket'));
  }

  /**
   * A plain workspace member resolves that workspace's projects for statistics.
   *
   * The distinction this test pins is D2: `projectIds()` stays what BB-318
   * decided (membership plus see-all), so a plain member resolves NO projects
   * there — while the statistics set resolves its whole workspace, because a
   * count is a workspace-level aggregate. Two different questions, deliberately
   * two different sets.
   */
  public function testStatisticsProjectSetIsWorkspaceWideForPlainMember(): void {
    $account = $this->member('a');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);

    self::assertSame([], $this->scope()->projectIds($account));
    self::assertSame(
      [(int) $this->fixture('a', 'bb_project')->id()],
      $this->scope()->workspaceProjectIds($account),
    );
  }

  /**
   * The statistics set unions team-derived visibility, no workspace needed.
   *
   * OG has no inheritance, so a team membership without a workspace one is
   * expressible (BbWorkspaceReadScope says so in its own docblock). Such an
   * account must not fall out of its own project's figures.
   *
   * Rewritten for BB-462 D4/D7: the direct project OG membership this test
   * used to exercise no longer exists — project visibility is derived from
   * team membership instead.
   */
  public function testStatisticsProjectSetUnionsTeamDerivedProjectMembership(): void {
    $account = $this->member('b');
    $this->addMembership($this->fixture('b', 'bb_team'), $account, []);

    self::assertSame([], $this->scope()->workspaceIds($account));
    self::assertSame(
      [(int) $this->fixture('b', 'bb_project')->id()],
      $this->scope()->workspaceProjectIds($account),
    );
  }

  /**
   * No membership resolves an empty statistics set — never every project.
   */
  public function testStatisticsProjectSetIsEmptyWithoutAnyMembership(): void {
    self::assertSame([], $this->scope()->workspaceProjectIds($this->member('a')));
  }

}
