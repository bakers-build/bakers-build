<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies bb_team is a workspace-scoped OG group with the shipped roles.
 *
 * BB-321 V1: the crew entity exists, belongs to a workspace, accepts
 * membership through og_membership, and ships only non-member + member
 * roles. BB-479 gives `member` its first permissions — the three general
 * statistic reads — so `non-member` stays the empty floor while `member` no
 * longer does.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TeamOgGroupTest extends KernelTestBase {

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
   * The two roles the team ships, keyed by role name => role_type.
   *
   * @var array<string, string>
   */
  private const EXPECTED_ROLES = [
    'non-member' => 'required',
    'member' => 'required',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installConfig(['og']);
    // og_membership's default bundle only exists after config install; without
    // this refresh, createMembership fails with "Missing bundle".
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->installShippedTeamRoles();
    $this->registerTeamAsGroup();
  }

  /**
   * A team belongs to a workspace and accepts an OG membership.
   */
  public function testTeamBelongsToWorkspaceAndAcceptsMembership(): void {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Acme']);
    $workspace->save();

    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create([
        'name' => 'Platform',
        'workspace_id' => $workspace->id(),
      ]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();

    $user = $this->createAccount('team-member');
    $membership = Og::createMembership($team, $user);
    $membership->setState(OgMembershipInterface::STATE_ACTIVE);
    $membership->save();

    self::assertTrue(Og::isGroup('bb_team', 'bb_team'));
    self::assertSame($workspace->id(), $team->get('workspace_id')->target_id);
    self::assertNotEmpty(
      $this->container->get('og.membership_manager')->getMembership($team, (int) $user->id()),
    );
  }

  /**
   * Shipped team roles: `non-member` empty, `member` gets reads (BB-479).
   */
  public function testTeamRolesCarryExpectedPermissions(): void {
    $expected_permissions = [
      'non-member' => [],
      'member' => [
        'view bakers figure project_overview',
        'view bakers figure team_projects',
      ],
    ];

    foreach (array_keys(self::EXPECTED_ROLES) as $name) {
      $role = OgRole::load('bb_team-bb_team-' . $name);
      self::assertInstanceOf(OgRole::class, $role, "Role $name is shipped.");
      self::assertSame($expected_permissions[$name], $role->getPermissions(), "Role $name permissions.");
      self::assertSame('bb_team', $role->getGroupType());
      self::assertSame('bb_team', $role->getGroupBundle());
      self::assertFalse($role->isAdmin(), "Role $name is_admin.");
    }

    self::assertCount(2, OgRole::loadByGroupType('bb_team', 'bb_team'));
  }

  /**
   * The shipped og.settings value registers the team as an OG group.
   */
  public function testShippedSettingsRegisterTheTeamAsGroup(): void {
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $data = $storage->read('og.settings');
    self::assertIsArray($data, 'config/sync/og.settings.yml exists.');
    self::assertSame(['bb_team'], $data['groups']['bb_team'] ?? NULL);

    $this->config('og.settings')->set('groups', $data['groups'])->save();
    $this->container->get('og.group_type_manager')->reset();
    self::assertTrue(Og::isGroup('bb_team', 'bb_team'));
  }

  /**
   * Registers bb_team from the shipped config/sync og.settings.
   */
  private function registerTeamAsGroup(): void {
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $data = $storage->read('og.settings');
    self::assertIsArray($data);
    $this->config('og.settings')->set('groups', $data['groups'])->save();
    $this->container->get('og.group_type_manager')->reset();
  }

  /**
   * Installs the two shipped team OG roles from config/install.
   */
  private function installShippedTeamRoles(): void {
    $path = $this->container->get('extension.list.module')->getPath('bb_core');
    $source = new FileStorage($path . '/config/install');
    $storage = $this->container->get('entity_type.manager')->getStorage('og_role');
    foreach (array_keys(self::EXPECTED_ROLES) as $name) {
      $config_name = 'og.og_role.bb_team-bb_team-' . $name;
      $data = $source->read($config_name);
      self::assertIsArray($data, "Shipped config for role $name exists.");
      $storage->create($data)->save();
    }
  }

  /**
   * Creates and saves a plain user account.
   */
  private function createAccount(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')
      ->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

}
