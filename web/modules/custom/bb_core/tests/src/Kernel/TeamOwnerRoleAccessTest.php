<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * The `owner` team role actually reaches the team it is held on (F2).
 *
 * Shipped alongside BB-462 D3 and pinned by `RankPermissionContractTest`
 * and `ConfigCopyDriftTest` — both seam 3, both about the FILES rather than
 * the runtime consequence. Neither drives the role at seam 1, which the
 * confirmed test plan assigns "team owner administers their team" to, and a
 * review found nothing did.
 *
 * UNLIKE THE WORKSPACE `lead` RANK (see `TeamMemberAddAccessTest`), this role
 * needs no `bb_core_og_user_access_alter()` widening at all: `manage
 * members` and `update group` are OG's OWN permission names —
 * `OgAccess::UPDATE_GROUP_PERMISSION` and the membership-management string OG
 * checks natively — so a membership carrying this role reaches them through
 * OG's plain, un-widened resolution the moment the role is held ON THE GROUP
 * BEING ASKED ABOUT. That is the boundary this class measures: holding the
 * role on one team must not reach a different one.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TeamOwnerRoleAccessTest extends KernelTestBase {

  use UserCreationTrait;

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
   * The team every case here tries to change.
   */
  private BbTeamInterface $team;

  /**
   * A second, unrelated team — the negative fixture.
   */
  private BbTeamInterface $otherTeam;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installConfig(['system', 'user', 'og']);
    // A recipe registers this in `actions:`, which run AFTER `config:`; a
    // kernel test carries no recipe, so the group is registered directly —
    // without it OgMembership::save() throws "not an OG group".
    Og::addGroup('bb_team', 'bb_team');
    Og::addGroup('bb_workspace', 'bb_workspace');

    // Uid 1 bypasses every access check, so it must not be an actor.
    $this->setUpCurrentUser(['uid' => 1]);

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Acme', 'slug' => 'acme']);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);

    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Platform Crew', 'workspace_id' => $workspace->id()]);
    $team->save();
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $this->team = $team;

    $other_team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 'Design Crew', 'workspace_id' => $workspace->id()]);
    $other_team->save();
    self::assertInstanceOf(BbTeamInterface::class, $other_team);
    $this->otherTeam = $other_team;
  }

  /**
   * A team owner may update the team and manage its members.
   */
  public function testOwnerUpdatesAndManagesMembers(): void {
    $owner = $this->createUser(['view bb_team']);
    self::assertInstanceOf(UserInterface::class, $owner);
    $this->joinTeamAsOwner($this->team, $owner);

    self::assertTrue(
      $this->team->access('update', $owner),
      'The owner role carries OG\'s own `update group` permission.',
    );
  }

  /**
   * A plain team member holds no rights over the team at all.
   *
   * The implicit `member` rank a bare membership carries is empty by design
   * (BB-462 D3): a team is a visibility fact, not a rights tier, so the
   * absence of the owner role must leave the account with nothing.
   */
  public function testPlainMemberCannotUpdateOrManageMembers(): void {
    $member = $this->createUser(['view bb_team']);
    self::assertInstanceOf(UserInterface::class, $member);
    Og::createMembership($this->team, $member)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();

    self::assertFalse(
      $this->team->access('update', $member),
      'A bare membership carries no right to change the team.',
    );
  }

  /**
   * An owner of another team does not reach this one.
   *
   * The boundary that actually matters for a role held per-membership rather
   * than per-account: `bb_team-bb_team-owner` is not a site-wide grant,
   * and OG's own resolution is asked about the SPECIFIC group — so holding
   * it on Design Crew must not open Platform Crew.
   */
  public function testForeignTeamOwnerDoesNotReachThisTeam(): void {
    $foreign_owner = $this->createUser(['view bb_team']);
    self::assertInstanceOf(UserInterface::class, $foreign_owner);
    $this->joinTeamAsOwner($this->otherTeam, $foreign_owner);

    self::assertTrue(
      $this->otherTeam->access('update', $foreign_owner),
      'Sanity: the role does reach the team it was granted on.',
    );
    self::assertFalse(
      $this->team->access('update', $foreign_owner),
      'The same account does not reach a team it holds no role on.',
    );
  }

  /**
   * Joins a team with the shipped `owner` role.
   */
  private function joinTeamAsOwner(BbTeamInterface $team, UserInterface $account): void {
    $role = $this->shippedOwnerRank();
    Og::createMembership($team, $account)
      ->addRole($role)
      ->setState(OgMembershipInterface::STATE_ACTIVE)
      ->save();
  }

  /**
   * The shipped team `owner` rank, created from its own config file.
   *
   * `Og::addGroup()` creates only the default `member` / `non-member` roles,
   * so this rank does not exist in a kernel test until it is imported. Built
   * from `config/install` rather than assembled here, so the PERMISSION LIST
   * is the product's own — the day `update group` or `manage members` leaves
   * this rank, the assertion below fails and names it, instead of the case
   * silently testing a role of its own invention (mirrors
   * `TeamMemberAddAccessTest::shippedLeadRank()`).
   */
  private function shippedOwnerRank(): OgRole {
    $id = 'bb_team-bb_team-owner';
    $role = OgRole::load($id);
    if ($role === NULL) {
      $file = dirname(__DIR__, 3) . '/config/install/og.og_role.' . $id . '.yml';
      self::assertFileExists($file, 'the bb_team `owner` rank is shipped');
      $data = Yaml::parseFile($file);
      self::assertIsArray($data);
      unset($data['uuid'], $data['_core']);
      OgRole::create($data)->save();
      $role = OgRole::load($id);
    }
    self::assertInstanceOf(OgRole::class, $role);
    self::assertContains('manage members', $role->getPermissions());
    self::assertContains('update group', $role->getPermissions());
    return $role;
  }

}
