<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * A heartbeat registers a conductor only where its owner may work.
 *
 * The owner must see the project (a team of it, or workspace Admin) and hold
 * `register bakers conductor` by rank in the project's workspace. A named
 * workspace scopes the lookup; an ambiguous name is refused.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorRegistrationAccessTest extends KernelTestBase {

  use UserCreationTrait;
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
    'serialization', 'filter', 'markdown_easy', 'consumers', 'simple_oauth', 'views', 'bb_api_key',
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
   * A Contributor of another workspace cannot register in this one.
   */
  public function testOwnerOfAnotherWorkspaceIsRefused(): void {
    $owner = $this->teamContributor('a');

    $this->assertRefusedLikeUnknownProject($owner, 'project-b');
  }

  /**
   * A Contributor of the workspace outside the project's teams is refused.
   */
  public function testOwnerOutsideTheProjectsTeamsIsRefused(): void {
    $owner = $this->createAccount('outsider');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $owner, ['contributor']);

    $this->assertRefusedLikeUnknownProject($owner, 'project-b');
  }

  /**
   * A Guest who sees the project through its team is refused.
   */
  public function testGuestInTheProjectsTeamIsRefused(): void {
    $owner = $this->createAccount('guest');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $owner, ['guest']);
    $this->addMembership($this->fixture('b', 'bb_team'), $owner);

    $this->assertRefusedLikeUnknownProject($owner, 'project-b');
  }

  /**
   * A named workspace binds the conductor to that workspace's project.
   */
  public function testNamedWorkspaceScopesTheLookup(): void {
    $owner = $this->dualContributor();
    [, $shared_b] = $this->createSharedProjects();

    $conductor = $this->heartbeat($owner, 'shared', ['workspace' => 'workspace-b']);

    self::assertSame((string) $shared_b, (string) $conductor->get('project_id')->target_id);
  }

  /**
   * A numeric workspace_id scopes the lookup like a workspace name.
   */
  public function testNamedWorkspaceIdScopesTheLookup(): void {
    $owner = $this->dualContributor();
    [, $shared_b] = $this->createSharedProjects();

    $conductor = $this->heartbeat($owner, 'shared', ['workspace_id' => $this->fixture('b', 'bb_workspace')->id()]);

    self::assertSame((string) $shared_b, (string) $conductor->get('project_id')->target_id);
  }

  /**
   * Two visible projects of one name without a workspace are refused.
   */
  public function testAmbiguousNameWithoutWorkspaceIsRefused(): void {
    $owner = $this->dualContributor();
    $this->createSharedProjects();

    $refusal = $this->refusal($owner, 'shared');

    self::assertNotNull($refusal, 'An ambiguous project name must be refused.');
    self::assertStringContainsString('workspace', $refusal->getMessage());
    $this->assertNothingWritten();
  }

  /**
   * A same-named project the owner cannot see plays no part in the lookup.
   */
  public function testInvisibleSameNameProjectPlaysNoPart(): void {
    $owner = $this->teamContributor('b');
    [, $shared_b] = $this->createSharedProjects();

    $conductor = $this->heartbeat($owner, 'shared');

    self::assertSame((string) $shared_b, (string) $conductor->get('project_id')->target_id);
  }

  /**
   * A team Contributor registers and keeps heartbeating.
   */
  public function testTeamContributorRegisters(): void {
    $owner = $this->teamContributor('b');

    $first = $this->heartbeat($owner, 'project-b');
    $second = $this->heartbeat($owner, 'project-b', ['current_load' => 2]);

    self::assertSame($first->id(), $second->id());
    self::assertSame((string) $this->fixture('b', 'bb_project')->id(), (string) $second->get('project_id')->target_id);
    self::assertSame(2, (int) $second->get('reported_load')->value);
  }

  /**
   * A workspace Admin outside the project's teams registers.
   */
  public function testWorkspaceAdminRegisters(): void {
    $owner = $this->createAccount('workspace-admin');
    $this->addMembership($this->fixture('b', 'bb_workspace'), $owner, ['lead']);

    $conductor = $this->heartbeat($owner, 'project-b');

    self::assertSame((string) $this->fixture('b', 'bb_project')->id(), (string) $conductor->get('project_id')->target_id);
  }

  /**
   * A workspace service account, Contributor in the project's team, registers.
   */
  public function testWorkspaceServiceAccountRegisters(): void {
    $workspace = $this->fixture('b', 'bb_workspace');
    $owner = $this->createEntity('user', [
      'name' => 'service-ci-aaaaaaaa',
      'status' => 1,
      'bb_service_workspace' => $workspace->id(),
    ]);
    self::assertInstanceOf(UserInterface::class, $owner);
    $this->addMembership($workspace, $owner, ['contributor']);
    $this->addMembership($this->fixture('b', 'bb_team'), $owner);

    $first = $this->heartbeat($owner, 'project-b');
    $second = $this->heartbeat($owner, 'project-b');

    self::assertSame($first->id(), $second->id());
    self::assertSame((string) $this->fixture('b', 'bb_project')->id(), (string) $second->get('project_id')->target_id);
  }

  /**
   * An existing conductor whose owner left the team is refused next time.
   */
  public function testOwnerWhoLostAccessIsRefusedOnNextHeartbeat(): void {
    $owner = $this->teamContributor('b');
    $conductor = $this->heartbeat($owner, 'project-b', ['current_load' => 1]);
    Og::getMembership($this->fixture('b', 'bb_team'), $owner, OgMembershipInterface::ALL_STATES)?->delete();
    $this->container->get('cache.static')->deleteAll();

    $refusal = $this->refusal($owner, 'project-b', ['current_load' => 4]);

    self::assertNotNull($refusal, 'The heartbeat of an owner without access must be refused.');
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->loadUnchanged($conductor->id());
    self::assertInstanceOf(BbConductorInterface::class, $reloaded);
    self::assertSame(1, (int) $reloaded->get('reported_load')->value, 'A refused heartbeat writes nothing.');
  }

  /**
   * Naming another visible project does not keep a lost conductor online.
   */
  public function testOwnerWhoLostAccessCannotHeartbeatThroughAnotherProject(): void {
    $owner = $this->dualContributor();
    [$shared_a] = $this->createSharedProjects();
    $conductor = $this->heartbeat($owner, 'shared', ['workspace' => 'workspace-a', 'current_load' => 1]);
    foreach (['bb_team', 'bb_workspace'] as $group) {
      Og::getMembership($this->fixture('a', $group), $owner, OgMembershipInterface::ALL_STATES)?->delete();
    }
    $this->container->get('cache.static')->deleteAll();

    $refusal = $this->refusal($owner, 'shared', ['current_load' => 4]);

    self::assertNotNull($refusal, 'The heartbeat must be refused, not rebound to another project.');
    self::assertSame('bakers.build project "shared" not found.', $refusal->getMessage());
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->loadUnchanged($conductor->id());
    self::assertInstanceOf(BbConductorInterface::class, $reloaded);
    self::assertSame((string) $shared_a, (string) $reloaded->get('project_id')->target_id);
    self::assertSame(1, (int) $reloaded->get('reported_load')->value, 'A refused heartbeat writes nothing.');
  }

  /**
   * A conductor moved to another project its owner may use keeps heartbeating.
   */
  public function testConductorMovedToAnotherAccessibleProjectKeepsHeartbeating(): void {
    $owner = $this->dualContributor();
    [, $shared_b] = $this->createSharedProjects();
    $conductor = $this->heartbeat($owner, 'shared', ['workspace' => 'workspace-a', 'current_load' => 1]);
    $conductor->set('project_id', $shared_b)->save();

    $refusal = $this->refusal($owner, 'shared', ['workspace' => 'workspace-a', 'current_load' => 4]);

    self::assertNull($refusal, 'The moved conductor must keep heartbeating.');
    $reloaded = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->loadUnchanged($conductor->id());
    self::assertInstanceOf(BbConductorInterface::class, $reloaded);
    self::assertSame((string) $shared_b, (string) $reloaded->get('project_id')->target_id, 'The stored binding is kept.');
    self::assertSame(4, (int) $reloaded->get('reported_load')->value);
  }

  /**
   * Asserts the refusal for a name is the one an unknown name gets.
   */
  private function assertRefusedLikeUnknownProject(UserInterface $owner, string $name): void {
    $refusal = $this->refusal($owner, $name);
    self::assertNotNull($refusal, 'The registration must be refused.');
    $unknown = $this->refusal($owner, 'no-such-project');
    self::assertNotNull($unknown);
    self::assertSame($unknown->getStatusCode(), $refusal->getStatusCode());
    self::assertGreaterThanOrEqual(400, $refusal->getStatusCode());
    self::assertLessThan(500, $refusal->getStatusCode());
    self::assertSame(
      str_replace('no-such-project', $name, $unknown->getMessage()),
      $refusal->getMessage(),
      'The refusal must not disclose that the project exists.',
    );
    $this->assertNothingWritten();
  }

  /**
   * Asserts no conductor and no machine was written.
   */
  private function assertNothingWritten(): void {
    $etm = $this->container->get('entity_type.manager');
    foreach (['bb_conductor', 'bb_machine'] as $type) {
      $ids = $etm->getStorage($type)->getQuery()->accessCheck(FALSE)->execute();
      // The world holds one fixture conductor and machine per side.
      self::assertCount(2, $ids, "A refused heartbeat writes no $type.");
    }
  }

  /**
   * Returns the heartbeat's HTTP refusal, or NULL when it was accepted.
   *
   * @param \Drupal\user\UserInterface $owner
   *   The conductor owner.
   * @param string $project
   *   The project name.
   * @param array<string, mixed> $extra
   *   Further heartbeat attributes.
   */
  private function refusal(UserInterface $owner, string $project, array $extra = []): ?HttpExceptionInterface {
    try {
      $this->heartbeat($owner, $project, $extra);
    }
    catch (HttpExceptionInterface $e) {
      return $e;
    }
    return NULL;
  }

  /**
   * Sends a heartbeat for the owner's conductor.
   *
   * @param \Drupal\user\UserInterface $owner
   *   The conductor owner.
   * @param string $project
   *   The project name.
   * @param array<string, mixed> $extra
   *   Further heartbeat attributes.
   */
  private function heartbeat(UserInterface $owner, string $project, array $extra = []): BbConductorInterface {
    return $this->container->get('bb_core.conductor_registrar')->heartbeat($owner, $extra + [
      'conductor_id' => 'cond-' . $owner->getAccountName(),
      'host_key' => vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(md5($owner->getAccountName()), 4)),
      'project' => $project,
    ]);
  }

  /**
   * Creates a Contributor in one side's workspace and team.
   */
  private function teamContributor(string $side): UserInterface {
    $owner = $this->createAccount("contributor-$side");
    $this->addMembership($this->fixture($side, 'bb_workspace'), $owner, ['contributor']);
    $this->addMembership($this->fixture($side, 'bb_team'), $owner);
    return $owner;
  }

  /**
   * Creates a Contributor in both workspaces and both teams.
   */
  private function dualContributor(): UserInterface {
    $owner = $this->createAccount('dual');
    foreach (['a', 'b'] as $side) {
      $this->addMembership($this->fixture($side, 'bb_workspace'), $owner, ['contributor']);
      $this->addMembership($this->fixture($side, 'bb_team'), $owner);
    }
    return $owner;
  }

  /**
   * Creates a project named "shared" on each side, side a first.
   *
   * @return array{int|string, int|string}
   *   The ids of side a's and side b's project.
   */
  private function createSharedProjects(): array {
    $ids = [];
    foreach (['a', 'b'] as $side) {
      $ids[] = $this->createEntity('bb_project', [
        'name' => 'shared',
        'group_id' => $this->fixture($side, 'bb_group')->id(),
        'teams' => [$this->fixture($side, 'bb_team')->id()],
      ])->id();
    }
    return [$ids[0], $ids[1]];
  }

}
