<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Schema and persistence for the bb_machine host capacity entity (BB-353).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MachineEntityTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user',
      'og_membership',
      'bb_machine',
    ] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * A machine persists host_key, capacity and owner, with no workspace field.
   */
  public function testMachinePersistsCanonicalFields(): void {
    $owner = $this->createUser('machine-owner');

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_machine');
    $machine = $storage->create([
      'name' => 'dev laptop',
      'host_key' => 'cw-laptop',
      'max_parallel' => 4,
      'current_load' => 2,
      'owner_user_id' => $owner->id(),
    ]);
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();

    $loaded = $storage->load($machine->id());
    $this->assertInstanceOf(BbMachineInterface::class, $loaded);
    $this->assertSame('dev laptop', $loaded->label());
    $this->assertSame('cw-laptop', $loaded->getHostKey());
    $this->assertSame(4, $loaded->getMaxParallel());
    $this->assertSame(2, $loaded->getCurrentLoad());
    $this->assertFalse($loaded->hasField('workspace_id'));
    $this->assertSame((int) $owner->id(), (int) $loaded->get('owner_user_id')->target_id);

    $by_uuid = $storage->loadByProperties(['uuid' => $loaded->uuid()]);
    $this->assertCount(1, $by_uuid);
    $this->assertSame($loaded->id(), reset($by_uuid)->id());
  }

  /**
   * Host key is required and unique (UniqueField).
   */
  public function testConnectionUrlUpdatePreservesExistingMachines(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_machine');
    $machine = $storage->create(['name' => 'existing', 'host_key' => 'existing']);
    $machine->save();
    $manager = $this->container->get('entity.definition_update_manager');
    $manager->uninstallFieldStorageDefinition($manager->getFieldStorageDefinition('connection_url', 'bb_machine'));
    require_once DRUPAL_ROOT . '/modules/custom/bb_core/bb_core.post_update.php';
    bb_core_post_update_machine_connection_url();
    bb_core_post_update_machine_connection_url();
    $loaded = $storage->loadUnchanged($machine->id());
    $this->assertSame('existing', $loaded->label());
    $this->assertNull($loaded->get('connection_url')->value);
    $this->assertNotNull($manager->getFieldStorageDefinition('connection_url', 'bb_machine'));
  }

  /**
   * Connection addresses persist exactly and reject unsafe input.
   */
  public function testConnectionUrlValidationAndPersistence(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_machine');
    $machine = $storage->create(['name' => 'connection', 'host_key' => 'connection']);
    foreach ([NULL, 'ssh://christian@192.168.1.20:22', 'ssh://user%2Dname@[::1]:2222/', 'ssh://host', 'https://example.com/path?q=value#section'] as $value) {
      $machine->set('connection_url', $value);
      $this->assertCount(0, $machine->validate()->getByField('connection_url'));
      $machine->save();
      $this->assertSame($value, $storage->loadUnchanged($machine->id())->get('connection_url')->value);
    }
    foreach (['http://host', '/relative', 'ssh://user:password@host', 'https://user@host', 'ssh://host/path', 'ssh://host?x', 'ssh://host#x', 'ssh://host:0', 'ssh://host:65536', 'ssh://host:', 'ssh://bad_host', 'ssh://-bad.host', 'ssh://999.1.1.1', 'ssh://[bad]', 'ssh://user%zz@host', 'ssh://user%00@host', 'ssh://user%20name@host', "ssh://host\n", 'https://host/%zz', 'https://host/' . str_repeat('a', 2048)] as $value) {
      $machine->set('connection_url', $value);
      $this->assertGreaterThan(0, count($machine->validate()->getByField('connection_url')), $value);
    }
  }

  /**
   * Host key is required and unique (UniqueField).
   */
  public function testHostKeyIsRequiredAndUnique(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_machine');

    $first = $storage->create([
      'name' => 'first',
      'host_key' => 'shared-host',
    ]);
    $this->assertInstanceOf(ContentEntityInterface::class, $first);
    $this->assertCount(0, $first->validate()->getByField('host_key'));
    $first->save();

    $missing = $storage->create([
      'name' => 'no-key',
    ]);
    $this->assertInstanceOf(ContentEntityInterface::class, $missing);
    $this->assertGreaterThan(0, count($missing->validate()->getByField('host_key')));

    $dup = $storage->create([
      'name' => 'second',
      'host_key' => 'shared-host',
    ]);
    $this->assertInstanceOf(ContentEntityInterface::class, $dup);
    $this->assertGreaterThan(0, count($dup->validate()->getByField('host_key')));
  }

  /**
   * Max parallel and current load default to 5 and 0 when omitted.
   */
  public function testCapacityDefaults(): void {
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')
      ->create([
        'name' => 'defaults',
        'host_key' => 'host-defaults',
      ]);
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();
    $this->assertSame(5, $machine->getMaxParallel());
    $this->assertSame(0, $machine->getCurrentLoad());
  }

  /**
   * Creates a Drupal user.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

}
