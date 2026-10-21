<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Utility\SortArray;
use Drupal\Core\Config\FileStorage;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\og\OgRoleInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies bb_workspace is an OG group carrying the six shipped roles (V2).
 *
 * OG is wired purely declaratively (BB-316 D2): the registration is one
 * og.settings key and the roles are six shipped config entities. OG's
 * imperative GroupTypeManager::addGroup() is never called, so nothing but the
 * shipped config decides which roles exist — which is exactly what this test
 * pins down.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceOgGroupTest extends KernelTestBase {

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
   * The roles the workspace ships, keyed by role name => role_type.
   *
   * `non-member` and `member` are OG's structurally required roles — OgRole
   * derives the type from the NAME, so bakers.build's `member` IS OG's required role
   * rather than a second role sharing its name (Fact 8).
   *
   * @var array<string, string>
   */
  private const EXPECTED_ROLES = [
    'non-member' => OgRoleInterface::ROLE_TYPE_REQUIRED,
    'member' => OgRoleInterface::ROLE_TYPE_REQUIRED,
    // BB-359 D12 collapsed `owner` and `admin` into this one rank.
    'lead' => OgRoleInterface::ROLE_TYPE_STANDARD,
    'guest' => OgRoleInterface::ROLE_TYPE_STANDARD,
    // `app` is GONE (BB-462 D9): the machine rank is removed entirely — a
    // conductor's OAuth identity sees what its owning user sees through the
    // user's own rank.
    // BB-462 D1/D2: the base creation rights `member` used to carry
    // implicitly now sit on this explicitly stored role instead.
    'contributor' => OgRoleInterface::ROLE_TYPE_STANDARD,
  ];

  /**
   * Roles that must stay empty (BB-462 D1).
   *
   * The implicit `member` rank and OG's structurally required `non-member`.
   *
   * @var array<string>
   */
  private const EMPTY_ROLES = ['non-member', 'member'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installConfig(['og']);
  }

  /**
   * The workspace entity type exists and stores the three specified fields.
   */
  public function testWorkspaceEntityTypeExists(): void {
    $definition = $this->container->get('entity_type.manager')
      ->getDefinition('bb_workspace');
    self::assertSame('bb_workspace', $definition->getBaseTable());
    self::assertSame('name', $definition->getKey('label'));
    self::assertSame('owner_user_id', $definition->getKey('owner'));

    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'Acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    self::assertSame('Acme', $workspace->getName());
    self::assertSame([], $workspace->getBillingProfile());
  }

  /**
   * The shipped og.settings value registers the workspace as an OG group.
   *
   * The value is read out of the shipped config/sync file rather than restated,
   * so a wrong shape in what we ship fails here instead of on the server.
   *
   * The assertion is on the workspace ENTRY, not on the whole `groups` map:
   * BB-317 registers bb_project beside it, and every later group would
   * break a whole-map assertion again while telling us nothing about the
   * workspace. What still has to hold is that the workspace entry survives —
   * the recipe's simpleConfigUpdate sets the whole key, so dropping it there
   * would silently unregister this group.
   */
  public function testShippedSettingsRegisterTheWorkspaceAsGroup(): void {
    $shipped = $this->readShippedOgSettingsGroups();
    self::assertSame(['bb_workspace'], $shipped['bb_workspace'] ?? NULL);

    $this->config('og.settings')->set('groups', $shipped)->save();
    // The group map is a per-request in-memory property, so drop the stale one.
    $this->container->get('og.group_type_manager')->reset();

    self::assertTrue(Og::isGroup('bb_workspace', 'bb_workspace'));
    // AC 5 — bb_group is deliberately NOT an OG group.
    self::assertFalse(Og::isGroup('bb_group', 'bb_group'));
  }

  /**
   * The five shipped role configs load with the expected role types.
   */
  public function testShippedRolesCarryTheExpectedRoleTypes(): void {
    $this->installShippedRoles();

    foreach (self::EXPECTED_ROLES as $name => $role_type) {
      $role = OgRole::load('bb_workspace-bb_workspace-' . $name);
      self::assertInstanceOf(OgRole::class, $role, "Role $name is shipped.");
      self::assertSame($role_type, $role->getRoleType(), "Role $name role_type.");
      self::assertSame($name, $role->getName());
      self::assertSame('bb_workspace', $role->getGroupType());
      self::assertSame('bb_workspace', $role->getGroupBundle());
      // BB-316 D7 shipped every rank empty; BB-359 D3 filled them, and a
      // rank that grants nothing is now the defect rather than the design —
      // except for EMPTY_ROLES, which must STAY empty. `non-member` because
      // OgAccess evaluates it for every account WITHOUT a membership, so a
      // permission there is granted to the whole authenticated world.
      // `member` because BB-462 D1 empties it deliberately: OG ranks are
      // additive and cannot be narrowed, so any right left there would be
      // inherited by every membership including guests — the rights it used
      // to carry implicitly now sit on the explicit `contributor` role. The
      // exact per-rank list is pinned once, against the live permission
      // registry, in RankPermissionContractTest — restating it here would be
      // a second copy to drift.
      if (in_array($name, self::EMPTY_ROLES, TRUE)) {
        self::assertSame([], $role->getPermissions(), "Role $name permissions.");
      }
      else {
        self::assertNotSame([], $role->getPermissions(), "Role $name permissions.");
      }
      // D2 — every rank is a plain standard role, never OG's `administrator`.
      self::assertFalse($role->isAdmin(), "Role $name is_admin.");
    }

    // Exactly five (BB-462 adds `contributor`, removes `app`), so an
    // OG-created `administrator` would fail here (Fact 3).
    self::assertCount(5, OgRole::loadByGroupType('bb_workspace', 'bb_workspace'));
  }

  /**
   * Saving a shipped role through the entity API does not rewrite the file.
   *
   * OgRole::preSave() assigns a weight when none is stated and sorts the
   * permissions (Fact 7). A file that omits either drifts from the active
   * config on first save and aborts the recipe's config.import.
   */
  public function testShippedRolesDoNotDriftOnSave(): void {
    $source = $this->shippedRoleStorage();
    $this->installShippedRoles();

    foreach (array_keys(self::EXPECTED_ROLES) as $name) {
      $config_name = 'og.og_role.bb_workspace-bb_workspace-' . $name;
      $role = OgRole::load('bb_workspace-bb_workspace-' . $name);
      self::assertInstanceOf(OgRole::class, $role);
      $role->save();

      $stored = $this->config($config_name)->getRawData();
      // The exact normalisation core's ConfigConfigurator applies before it
      // decides a recipe's config.import collides with the active config.
      unset($stored['uuid'], $stored['_core']);
      $shipped = $source->read($config_name);
      self::assertIsArray($shipped, "Shipped config for role $name exists.");
      SortArray::sortByKeyRecursive($stored);
      SortArray::sortByKeyRecursive($shipped);
      self::assertSame($shipped, $stored, "Role $name did not drift on save.");
    }
  }

  /**
   * Creates the six shipped roles through the entity API.
   *
   * The data comes from the module's own config/install directory, so the test
   * exercises the files that actually ship rather than a restatement of them.
   */
  private function installShippedRoles(): void {
    $source = $this->shippedRoleStorage();
    $storage = $this->container->get('entity_type.manager')->getStorage('og_role');
    foreach (array_keys(self::EXPECTED_ROLES) as $name) {
      $data = $source->read('og.og_role.bb_workspace-bb_workspace-' . $name);
      self::assertIsArray($data, "Shipped config for role $name exists.");
      $storage->create($data)->save();
    }
  }

  /**
   * Returns a file storage over the module's shipped config/install directory.
   */
  private function shippedRoleStorage(): FileStorage {
    $path = $this->container->get('extension.list.module')->getPath('bb_core');
    return new FileStorage($path . '/config/install');
  }

  /**
   * Reads og.settings.groups out of the shipped config/sync file.
   *
   * @return array<string, array<string>>
   *   The shipped group map.
   */
  private function readShippedOgSettingsGroups(): array {
    // $this->root is the Drupal app root (web/); config/sync sits beside it.
    $storage = new FileStorage(dirname($this->root) . '/config/sync');
    $data = $storage->read('og.settings');
    self::assertIsArray($data, 'config/sync/og.settings.yml exists.');
    self::assertArrayHasKey('groups', $data);
    return $data['groups'];
  }

}
