<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbWorkspace;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A fresh install owns a default workspace, on every install path (BB-350).
 *
 * Every product URL — `/bakers/team/1` and its siblings — is only a resolvable
 * path if a workspace with the slug `bakers` exists. Nothing guaranteed that on a
 * fresh install: bb_core_post_update_seed_default_workspace() is BASELINED on
 * a fresh install (core marks pending post-updates invoked instead of running
 * them), and only recipes/bb_e2e ever shipped workspace content — so a plain
 * `ddev init` and a server `site:install --existing-config`, where no recipe
 * runs at all, both booted with zero workspaces and every product URL a 404.
 * The symptom named here used to be `system.site.front: /bakers/dashboard`; since
 * BB-415 the front page is `/home`, which carries no workspace and answers
 * even on a workspaceless site. The product URLs are what this guards, and they
 * are the reason such an install is still broken — just quieter.
 *
 * hook_install() is the one seam all three paths share, so that is where the
 * default workspace is created. The body is shared with the post-update rather
 * than duplicated (Drupal\bb_core\Install\DefaultWorkspace), because "which
 * uuid, which slug, which owner" must have exactly one answer.
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
    'field', 'og', 'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group'] as $type) {
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
    self::assertNotSame('', $workspace->getName());
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
