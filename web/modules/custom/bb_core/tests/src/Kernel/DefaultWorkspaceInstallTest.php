<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Config\FileStorage;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbWorkspace;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\og\Entity\OgRole;
use Drupal\og\Og;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A fresh install owns a default workspace, led by the installing admin.
 *
 * Every product URL is only resolvable below a workspace slug, so every
 * install path (recipe, existing-config, plain site install) must create the
 * default workspace. hook_install() is the one seam all paths share.
 *
 * The hook is invoked directly here: KernelTestBase enables modules without
 * running hook_install, so the schema below is installed by hand and the hook
 * body is then exercised the way module_installer would.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class DefaultWorkspaceInstallTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'serialization', 'consumers',
    'simple_oauth', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group', 'consumer'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    // UID 1 — the owner the seeded workspace is given.
    $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'uid1-dummy', 'status' => 1])
      ->save();
    $this->container->get('module_handler')->loadInclude('bb_core', 'install');
  }

  /**
   * Installing bb_core creates the workspace the front page points at.
   */
  public function testInstallCreatesTheDefaultWorkspace(): void {
    self::assertSame([], $this->loadWorkspaces());

    bb_core_install();

    $workspace = $this->loadDefaultWorkspace();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    self::assertSame(BbWorkspace::DEFAULT_SLUG, $workspace->getSlug());
    self::assertSame('bakers', $workspace->getName());
  }

  /**
   * The name does not follow the site name.
   *
   * On `site:install --existing-config` this hook runs before system.site is
   * imported, so the site is still called "Drupal" at that moment.
   */
  public function testTheDefaultWorkspaceNameIgnoresTheInterimSiteName(): void {
    $this->config('system.site')->set('name', 'Drupal')->save();

    bb_core_install();

    self::assertSame('bakers', $this->loadDefaultWorkspace()->getName());
  }

  /**
   * Running the hook twice leaves exactly one workspace.
   *
   * The guard matters beyond re-runs: on the recipe-test path the e2e recipe
   * imports content into the very workspace this hook creates, so a second
   * create would fork the world in two.
   */
  public function testInstallIsIdempotent(): void {
    bb_core_install();
    bb_core_install();

    self::assertCount(1, $this->loadWorkspaces());
  }

  /**
   * An existing default workspace is left exactly as it is.
   */
  public function testInstallNeverOverwritesAnExistingDefaultWorkspace(): void {
    $storage = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace');
    $storage->create([
      'uuid' => BbWorkspace::DEFAULT_UUID,
      'name' => 'Hand-authored',
      'slug' => 'handmade',
      'owner_user_id' => 1,
    ])->save();

    bb_core_install();

    $workspace = $this->loadDefaultWorkspace();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    self::assertSame('handmade', $workspace->getSlug());
    self::assertSame('Hand-authored', $workspace->getName());
    self::assertCount(1, $this->loadWorkspaces());
  }

  /**
   * The seeded workspace passes its own validation constraints.
   *
   * The slug is a required, pattern- and uniqueness-constrained field, and the
   * hook writes through storage rather than through validation — so the value
   * it writes is asserted to be one the constraint would have accepted.
   */
  public function testTheSeededWorkspaceValidates(): void {
    bb_core_install();

    $workspace = $this->loadDefaultWorkspace();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    self::assertCount(0, $workspace->validate());
  }

  /**
   * On existing-config installs the admin leads once the ranks arrive.
   *
   * OG's settings come from config/sync when OG installs, but bb_core's config
   * entities are imported after its hook_install(), so the `lead` rank does
   * not exist yet when the default workspace is created.
   */
  public function testTheAdminLeadsWhenTheRanksArriveLast(): void {
    $this->registerWorkspaceGroup();
    bb_core_install();
    $this->importWorkspaceRanks();

    $this->assertTheOwnerLeadsTheDefaultWorkspace();
  }

  /**
   * On recipe installs the admin leads once the group is registered.
   *
   * The recipe imports the ranks as config and registers the group in its
   * `actions:`, which run after that import.
   */
  public function testTheAdminLeadsWhenTheGroupIsRegisteredLast(): void {
    bb_core_install();
    $this->importWorkspaceRanks();
    $this->registerWorkspaceGroup();

    $this->assertTheOwnerLeadsTheDefaultWorkspace();
  }

  /**
   * A later og.settings save leaves a demoted owner where they are.
   */
  public function testLaterGroupSaveDoesNotPromoteTheOwnerAgain(): void {
    bb_core_install();
    $this->importWorkspaceRanks();
    $this->registerWorkspaceGroup();
    $workspace = $this->loadDefaultWorkspace();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $owner = $workspace->get('owner_user_id')->entity;
    self::assertInstanceOf(UserInterface::class, $owner);
    $membership = Og::getMembership($workspace, $owner);
    self::assertNotNull($membership);
    $membership->revokeRoleById('bb_workspace-bb_workspace-lead')->save();

    $this->config('og.settings')
      ->set('groups', ['bb_workspace' => ['bb_workspace'], 'user' => ['user']])
      ->save();

    $membership = Og::getMembership($workspace, $owner);
    self::assertNotNull($membership);
    self::assertNotContains('bb_workspace-bb_workspace-lead', $membership->getRolesIds());
  }

  /**
   * Installing bb_core creates the public consumer the CLI signs in with.
   */
  public function testInstallCreatesTheCliConsumer(): void {
    bb_core_install();
    bb_core_install();

    $consumers = $this->container->get('entity_type.manager')
      ->getStorage('consumer')
      ->loadByProperties(['client_id' => 'bakers-cli']);
    self::assertCount(1, $consumers);
    $consumer = reset($consumers);
    self::assertInstanceOf(ContentEntityInterface::class, $consumer);
    self::assertFalse((bool) $consumer->get('confidential')->value);
    self::assertTrue((bool) $consumer->get('pkce')->value);
    self::assertSame(
      ['authorization_code', 'device_code', 'refresh_token'],
      array_column($consumer->get('grant_types')->getValue(), 'value'),
    );
    self::assertSame(3600, (int) $consumer->get('access_token_expiration')->value);
    self::assertSame('bb_session', $consumer->get('scopes')->scope_id);
    self::assertSame('http://localhost:7432/callback', $consumer->get('redirect')->value);
  }

  /**
   * Asserts the default workspace's owner holds the workspace `lead` rank.
   */
  private function assertTheOwnerLeadsTheDefaultWorkspace(): void {
    $workspace = $this->loadDefaultWorkspace();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $owner = $workspace->get('owner_user_id')->entity;
    self::assertInstanceOf(UserInterface::class, $owner);
    $membership = Og::getMembership($workspace, $owner);
    self::assertNotNull($membership);
    self::assertContains('bb_workspace-bb_workspace-lead', $membership->getRolesIds());
  }

  /**
   * Registers bb_workspace as an OG group through og.settings, as installs do.
   */
  private function registerWorkspaceGroup(): void {
    $this->config('og.settings')
      ->set('groups', ['bb_workspace' => ['bb_workspace']])
      ->save();
  }

  /**
   * Creates the workspace OG ranks bb_core ships, as a config import would.
   */
  private function importWorkspaceRanks(): void {
    $source = new FileStorage($this->container->get('extension.list.module')->getPath('bb_core') . '/config/install');
    foreach ($source->listAll('og.og_role.bb_workspace-') as $name) {
      OgRole::create((array) $source->read($name))->save();
    }
  }

  /**
   * Loads every workspace in the site.
   *
   * @return array<int|string, \Drupal\Core\Entity\EntityInterface>
   *   The workspaces, keyed by id.
   */
  private function loadWorkspaces(): array {
    return $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->loadMultiple();
  }

  /**
   * Loads the workspace anchored at BbWorkspace::DEFAULT_UUID.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface|null
   *   The default workspace, or NULL when it does not exist.
   */
  private function loadDefaultWorkspace(): ?BbWorkspaceInterface {
    $matches = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->loadByProperties(['uuid' => BbWorkspace::DEFAULT_UUID]);
    $workspace = reset($matches);
    return $workspace instanceof BbWorkspaceInterface ? $workspace : NULL;
  }

}
