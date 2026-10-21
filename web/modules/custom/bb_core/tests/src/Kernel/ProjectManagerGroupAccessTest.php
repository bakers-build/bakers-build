<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A workspace lead can create/update/view/delete a bb_group.
 *
 * `bb_project.group_id` is server-required, so `project:create` can only
 * complete end to end if whoever creates a project is allowed to ensure a
 * bb_group first. BbGroup uses the entity module's EntityPermissionProvider
 * and, since BB-305, implements EntityOwnerInterface — so the provider emits
 * `update any|own` and `delete any|own` in place of the bare verbs, while
 * `create` and `view` are unchanged. The rank takes the `any` variants: a lead
 * is meant to act on everyone's rows inside its own workspace.
 *
 * BB-359 D6 moved WHERE that capability comes from. It used to be the
 * site-wide `bb_project_manager` role, which this ticket deletes; it is now
 * the workspace `lead` rank, and the assertions moved with it rather than being
 * dropped — the guarantee they protect (a project can be created at all) is
 * unchanged, and a deleted test would have left it unmeasured.
 *
 * The negative half is new and is the point of the move: the same four
 * operations must be REFUSED on a group of a workspace the account holds no
 * rank in. Under the old role that question could not even be asked, because a
 * site-wide grant has no workspace.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectManagerGroupAccessTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'filter', 'bb_core',
  ];

  /**
   * The four bb_group permissions the workspace `lead` rank must carry.
   *
   * @var array<string>
   */
  private const GROUP_PERMS = [
    'create bb_group',
    'delete any bb_group',
    'update any bb_group',
    'view bb_group',
  ];

  /**
   * The rank that carries them, in both shipped copies.
   */
  private const LEAD_RANK = 'bb_workspace-bb_workspace-lead';

  private const CONFIG_INSTALL = DRUPAL_ROOT
    . '/modules/custom/bb_core/config/install/og.og_role.' . self::LEAD_RANK . '.yml';
  private const CONFIG_SYNC = DRUPAL_ROOT
    . '/../config/sync/og.og_role.' . self::LEAD_RANK . '.yml';

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
    // Uid 1 is a superuser; consume it so every actor below is normal.
    $this->createAccount('uid1-dummy');
  }

  /**
   * The shipped `lead` rank grants exactly the four bb_group permissions.
   */
  public function testShippedLeadRankGrantsGroupPermissions(): void {
    $perms = $this->decode(self::CONFIG_INSTALL)['permissions'] ?? [];
    foreach (self::GROUP_PERMS as $perm) {
      $this->assertContains($perm, $perms, "the lead rank must grant '$perm'");
    }
  }

  /**
   * The two shipped copies of the rank carry the identical permission set.
   */
  public function testRankPermissionsDoNotDrift(): void {
    $install = $this->decode(self::CONFIG_INSTALL)['permissions'] ?? [];
    $sync = $this->decode(self::CONFIG_SYNC)['permissions'] ?? [];
    sort($install);
    sort($sync);
    $this->assertSame($install, $sync, 'config/install and config/sync must not drift');
  }

  /**
   * A lead is granted every bb_group operation in its own workspace.
   */
  public function testWorkspaceLeadHasGroupAccess(): void {
    $workspace = $this->createWorkspace('keytec');
    $lead = $this->createAccount('lead-user');
    $this->addMembership($workspace, $lead, ['lead']);

    $handler = $this->container->get('entity_type.manager')->getAccessControlHandler('bb_group');
    $this->assertTrue($handler->createAccess(NULL, $lead), 'a lead may create a bb_group');

    $group = $this->createGroup('keytec', $workspace);
    $this->assertTrue($handler->access($group, 'view', $lead), 'a lead may view a bb_group');
    $this->assertTrue($handler->access($group, 'update', $lead), 'a lead may update a bb_group');
    $this->assertTrue($handler->access($group, 'delete', $lead), 'a lead may delete a bb_group');
  }

  /**
   * The same lead is refused on a group of another workspace.
   *
   * Layer B: the rank's permissions reach the tenancy that granted them and
   * nothing beyond it. Without this half the test above would also pass for a
   * grant that leaked everywhere.
   */
  public function testWorkspaceLeadIsRefusedInAnotherWorkspace(): void {
    $own = $this->createWorkspace('keytec');
    $foreign = $this->createWorkspace('other');
    $lead = $this->createAccount('lead-user');
    $this->addMembership($own, $lead, ['lead']);

    $group = $this->createGroup('other-group', $foreign);
    $handler = $this->container->get('entity_type.manager')->getAccessControlHandler('bb_group');

    $this->assertFalse($handler->access($group, 'view', $lead));
    $this->assertFalse($handler->access($group, 'update', $lead));
    $this->assertFalse($handler->access($group, 'delete', $lead));
  }

  /**
   * Creates a workspace.
   *
   * @param string $name
   *   The workspace name.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved workspace.
   */
  private function createWorkspace(string $name): ContentEntityInterface {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => $name]);
    $this->assertInstanceOf(ContentEntityInterface::class, $workspace);
    $workspace->save();

    return $workspace;
  }

  /**
   * Creates a group under a workspace.
   *
   * @param string $name
   *   The group name.
   * @param \Drupal\Core\Entity\ContentEntityInterface $workspace
   *   The owning workspace.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved group.
   */
  private function createGroup(string $name, ContentEntityInterface $workspace): ContentEntityInterface {
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => $name, 'workspace_id' => $workspace->id()]);
    $this->assertInstanceOf(ContentEntityInterface::class, $group);
    $group->save();

    return $group;
  }

  /**
   * Creates a plain account.
   *
   * @param string $name
   *   The account name.
   *
   * @return \Drupal\user\UserInterface
   *   The saved account.
   */
  private function createAccount(string $name): UserInterface {
    $account = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $account);
    $account->save();

    return $account;
  }

  /**
   * Decodes a shipped config file.
   *
   * @param string $path
   *   The absolute path.
   *
   * @return array<string, mixed>
   *   The decoded config.
   */
  private function decode(string $path): array {
    $this->assertFileExists($path);
    $decoded = Yaml::decode((string) file_get_contents($path));
    $this->assertIsArray($decoded);

    return $decoded;
  }

}
