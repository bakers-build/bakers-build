<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_webhook\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\og\Entity\OgRole;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The module installs and uninstalls without touching the shipped roles.
 */
#[Group('bb_webhook')]
#[RunTestsInSeparateProcesses]
final class WebhookInstallTest extends KernelTestBase {

  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'filter', 'field', 'og', 'views', 'bb_core', 'bb_activity',
  ];

  /**
   * Install creates the table; uninstall drops it and keeps the Admin role.
   */
  public function testUninstallRemovesEntityAndPermission(): void {
    $this->installEntitySchema('user');
    $this->installSchema('user', ['users_data']);
    foreach (['bb_workspace', 'bb_group', 'bb_team', 'bb_project', 'bb_ticket', 'bb_activity'] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installOgScopeFixture();
    $installer = $this->container->get('module_installer');
    $schema = $this->container->get('database')->schema();

    $installer->install(['bb_webhook']);
    $this->assertTrue($schema->tableExists('bb_webhook'));
    $this->assertContains('view bb_webhook', array_keys($this->container->get('user.permissions')->getPermissions()));

    $installer->uninstall(['bb_webhook']);
    $this->assertFalse($schema->tableExists('bb_webhook'));
    $this->assertNotContains('view bb_webhook', array_keys($this->container->get('user.permissions')->getPermissions()));
    $this->assertNotNull(OgRole::load('bb_workspace-bb_workspace-lead'), 'the Admin role survives the uninstall');
  }

}
