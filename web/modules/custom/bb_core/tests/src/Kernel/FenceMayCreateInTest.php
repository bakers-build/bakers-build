<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Access\BbRankEntityFence;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * One rule answers "may this account create a ticket in this project".
 *
 * Workspace a holds two projects: the fixture's (team a) and a sibling on its
 * own team, so a team rank reaches one project and not the other.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class FenceMayCreateInTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og',
    'island', 'bb_core',
  ];

  /**
   * The sibling project of workspace a, on its own team.
   */
  private ContentEntityInterface $sibling;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installReadScopeEnvironment();
    $this->buildTwoWorkspaceWorld();
    $this->sibling = $this->createSiblingProject();
  }

  /**
   * A workspace contributor may create in every project of the workspace.
   */
  public function testContributorMayCreateInEveryWorkspaceProject(): void {
    $account = $this->createAccount('contributor');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['contributor']);

    self::assertTrue($this->mayCreateIn($account, $this->fixture('a', 'bb_project')));
    self::assertTrue($this->mayCreateIn($account, $this->sibling));
    self::assertFalse($this->mayCreateIn($account, $this->fixture('b', 'bb_project')));
  }

  /**
   * A plain workspace member may create nowhere.
   */
  public function testMemberMayNotCreate(): void {
    $account = $this->createAccount('plain-member');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $account);

    self::assertFalse($this->mayCreateIn($account, $this->fixture('a', 'bb_project')));
    self::assertFalse($this->mayCreateIn($account, $this->sibling));
  }

  /**
   * A team reporter may create only in its team's project.
   */
  public function testTeamReporterMayCreateOnlyInItsTeamsProject(): void {
    $this->installTeamReporterRole();
    $account = $this->createAccount('reporter');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $account, ['member']);
    $this->addMembership($this->fixture('a', 'bb_team'), $account, ['reporter']);

    self::assertTrue($this->mayCreateIn($account, $this->fixture('a', 'bb_project')));
    self::assertFalse($this->mayCreateIn($account, $this->sibling));
  }

  /**
   * A site-wide grant may create anywhere.
   */
  public function testSiteWideGrantMayCreateAnywhere(): void {
    $account = $this->createAccount('operator', ['create bb_ticket']);

    self::assertTrue($this->mayCreateIn($account, $this->fixture('a', 'bb_project')));
    self::assertTrue($this->mayCreateIn($account, $this->fixture('b', 'bb_project')));
  }

  /**
   * Creates a second project in workspace a on a team of its own.
   */
  private function createSiblingProject(): ContentEntityInterface {
    $owner = $this->fixture('a', 'bb_project')->get('owner_user_id')->target_id;
    $team = $this->createEntity('bb_team', [
      'name' => 'team-a-sibling',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      'owner_user_id' => $owner,
    ]);
    return $this->createEntity('bb_project', [
      'name' => 'project-a-sibling',
      'group_id' => $this->fixture('a', 'bb_project')->get('group_id')->target_id,
      'teams' => [$team->id()],
      'owner_user_id' => $owner,
    ]);
  }

  /**
   * Installs the team reporter role, which ships with the recipe.
   */
  private function installTeamReporterRole(): void {
    $data = (new FileStorage(dirname($this->root) . '/config/sync'))->read('og.og_role.bb_team-bb_team-reporter');
    self::assertIsArray($data);
    $this->container->get('entity_type.manager')->getStorage('og_role')->create($data)->save();
  }

  /**
   * Asks the fence.
   */
  private function mayCreateIn(UserInterface $account, ContentEntityInterface $project): bool {
    $fence = $this->container->get('bb_core.rank_entity_fence');
    self::assertInstanceOf(BbRankEntityFence::class, $fence);
    return $fence->mayCreateIn($account, 'bb_ticket', $project);
  }

}
