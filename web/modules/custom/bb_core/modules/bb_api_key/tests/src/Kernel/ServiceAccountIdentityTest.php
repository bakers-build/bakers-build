<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\og\Entity\OgRole;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_api_key\ServiceAccountManager;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgMembership;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The service-account marker, its invariants and the OG rank allowlist.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ServiceAccountIdentityTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og',
    'consumers', 'simple_oauth', 'views', 'bb_core', 'bb_api_key',
  ];

  /**
   * The workspace owning the service accounts under test.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * A second, foreign workspace used for isolation assertions.
   */
  private BbWorkspaceInterface $otherWorkspace;

  /**
   * A team inside the owning workspace.
   */
  private BbTeamInterface $team;

  /**
   * A team inside the foreign workspace.
   */
  private BbTeamInterface $foreignTeam;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installEntitySchema('consumer');
    $this->installConfig(['system', 'user', 'og', 'bb_core', 'bb_api_key']);
    Og::addGroup('bb_workspace', 'bb_workspace');
    Og::addGroup('bb_team', 'bb_team');

    $entityTypeManager = $this->container->get('entity_type.manager');
    $workspace = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $other = $entityTypeManager->getStorage('bb_workspace')->create(['name' => 'Other', 'slug' => 'other']);
    $other->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $other);
    $this->otherWorkspace = $other;

    $team = $entityTypeManager->getStorage('bb_team')->create([
      'name' => 'API home',
      'workspace_id' => $this->workspace->id(),
    ]);
    $team->save();
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $this->team = $team;

    $foreignTeam = $entityTypeManager->getStorage('bb_team')->create([
      'name' => 'Foreign',
      'workspace_id' => $this->otherWorkspace->id(),
    ]);
    $foreignTeam->save();
    self::assertInstanceOf(BbTeamInterface::class, $foreignTeam);
    $this->foreignTeam = $foreignTeam;
  }

  /**
   * A human user's marker field stays NULL and ServiceAccountManager agrees.
   */
  public function testHumanMarkerStaysNull(): void {
    $human = $this->createUser();
    self::assertInstanceOf(User::class, $human);
    $this->assertTrue($human->get(ServiceAccountManager::MARKER_FIELD)->isEmpty());

    $manager = $this->container->get(ServiceAccountManager::class);
    $this->assertFalse($manager->isServiceAccount($human));
    $this->assertNull($manager->workspaceId($human));
  }

  /**
   * A freshly created service account satisfies every identity invariant.
   */
  public function testServiceAccountIdentityInvariants(): void {
    $service = $this->createServiceAccount($this->workspace);
    $manager = $this->container->get(ServiceAccountManager::class);

    $this->assertTrue($manager->isServiceAccount($service));
    $this->assertTrue($manager->belongsTo($service, $this->workspace));
    $this->assertFalse($manager->belongsTo($service, $this->otherWorkspace));
    $this->assertSame('', (string) $service->getEmail());
    $this->assertSame([], $service->getRoles(TRUE));
  }

  /**
   * Once set, the workspace binding cannot be changed, not even cleared.
   */
  public function testMarkerIsImmutable(): void {
    $service = $this->createServiceAccount($this->workspace);

    $this->expectException(EntityStorageException::class);
    $service->set(ServiceAccountManager::MARKER_FIELD, $this->otherWorkspace->id());
    $service->save();
  }

  /**
   * A service account cannot be given an email address.
   */
  public function testServiceAccountCannotHoldEmail(): void {
    $this->expectException(EntityStorageException::class);
    $this->makeUser([
      'mail' => 'robot@example.com',
      ServiceAccountManager::MARKER_FIELD => $this->workspace->id(),
    ])->save();
  }

  /**
   * A service account cannot hold a usable password.
   */
  public function testServiceAccountCannotHoldPassword(): void {
    $this->expectException(EntityStorageException::class);
    $this->makeUser([
      'pass' => 'Bb-test-login-426!',
      ServiceAccountManager::MARKER_FIELD => $this->workspace->id(),
    ])->save();
  }

  /**
   * A service account cannot hold a site-wide Drupal role.
   */
  public function testServiceAccountCannotHoldSiteRole(): void {
    $role = $this->createRole([], 'editor');
    $this->expectException(EntityStorageException::class);
    $this->makeUser([
      'roles' => [$role],
      ServiceAccountManager::MARKER_FIELD => $this->workspace->id(),
    ])->save();
  }

  /**
   * Disable is the sole lifecycle exit: deletion is rejected.
   */
  public function testServiceAccountCannotBeDeleted(): void {
    $service = $this->createServiceAccount($this->workspace);
    $this->expectException(EntityStorageException::class);
    $service->delete();
  }

  /**
   * Status changes through ordinary user administration are rejected.
   */
  public function testServiceAccountStatusIsImmutableThroughOrdinarySave(): void {
    $service = $this->createServiceAccount($this->workspace);
    $this->expectException(EntityStorageException::class);
    $service->set('status', FALSE);
    $service->save();
  }

  /**
   * A service account may join its own workspace as Guest or Contributor.
   */
  public function testServiceAccountMayHoldAllowedWorkspaceRoles(): void {
    $service = $this->createServiceAccount($this->workspace);
    $membership = $this->membership($service, $this->workspace, 'bb_workspace-bb_workspace-guest');
    $this->assertTrue($membership->hasRole('bb_workspace-bb_workspace-guest'));
  }

  /**
   * A service account cannot join a workspace other than its own binding.
   */
  public function testServiceAccountCannotJoinForeignWorkspace(): void {
    $service = $this->createServiceAccount($this->workspace);
    $this->expectException(EntityStorageException::class);
    $this->membership($service, $this->otherWorkspace, NULL);
  }

  /**
   * A service account cannot be given the workspace Lead rank.
   */
  public function testServiceAccountCannotHoldWorkspaceLead(): void {
    $service = $this->createServiceAccount($this->workspace);
    $this->expectException(EntityStorageException::class);
    $this->membership($service, $this->workspace, 'bb_workspace-bb_workspace-lead');
  }

  /**
   * A service account may join a team of its own workspace as Reporter.
   */
  public function testServiceAccountMayHoldTeamReporter(): void {
    $service = $this->createServiceAccount($this->workspace);
    $membership = $this->membership($service, $this->team, 'bb_team-bb_team-reporter');
    $this->assertTrue($membership->hasRole('bb_team-bb_team-reporter'));
  }

  /**
   * A service account cannot join a team outside its bound workspace.
   */
  public function testServiceAccountCannotJoinForeignTeam(): void {
    $service = $this->createServiceAccount($this->workspace);
    $this->expectException(EntityStorageException::class);
    $this->membership($service, $this->foreignTeam, NULL);
  }

  /**
   * A service account cannot be given the team Lead/Owner rank.
   */
  public function testServiceAccountCannotHoldTeamLead(): void {
    $service = $this->createServiceAccount($this->workspace);
    $this->expectException(EntityStorageException::class);
    $this->membership($service, $this->team, 'bb_team-bb_team-lead');
  }

  /**
   * A human member is entirely unaffected by the service-account guards.
   */
  public function testHumanMembershipUnaffectedByGuards(): void {
    $human = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $human);
    $membership = $this->membership($human, $this->otherWorkspace, 'bb_workspace-bb_workspace-lead');
    $this->assertTrue($membership->hasRole('bb_workspace-bb_workspace-lead'));
  }

  /**
   * Creates and saves a valid service account bound to the given workspace.
   */
  private function createServiceAccount(BbWorkspaceInterface $workspace): UserInterface {
    $user = $this->makeUser([ServiceAccountManager::MARKER_FIELD => $workspace->id()]);
    $user->save();
    return $user;
  }

  /**
   * Builds (but does not save) a user with the given extra field values.
   *
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  private function makeUser(array $values): UserInterface {
    $user = User::create($values + [
      'name' => $this->randomMachineName(),
      'status' => 1,
    ]);
    self::assertInstanceOf(UserInterface::class, $user);
    return $user;
  }

  /**
   * Creates (and may throw while saving) one membership for the given group.
   */
  private function membership(UserInterface $account, BbWorkspaceInterface|BbTeamInterface $group, ?string $roleId): OgMembershipInterface {
    $membership = OgMembership::create(['type' => OgMembershipInterface::TYPE_DEFAULT])
      ->setOwner($account)
      ->setGroup($group)
      ->setState(OgMembershipInterface::STATE_ACTIVE);
    if ($roleId !== NULL) {
      $role = OgRole::getRole($group->getEntityTypeId(), $group->bundle(), substr($roleId, strrpos($roleId, '-') + 1));
      self::assertNotNull($role, "Role $roleId must exist.");
      $membership->setRoles([$role]);
    }
    $membership->save();
    return $membership;
  }

}
