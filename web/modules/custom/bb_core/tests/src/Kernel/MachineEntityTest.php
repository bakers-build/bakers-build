<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

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
   * A machine persists its UUID, capacity and owner, with no workspace field.
   */
  public function testMachinePersistsCanonicalFields(): void {
    $owner = $this->createUser('machine-owner');

    $storage = $this->container->get('entity_type.manager')->getStorage('bb_machine');
    $machine = $storage->create([
      'uuid' => '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
      'name' => 'dev laptop',
      'max_parallel' => 4,
      'current_load' => 2,
      'owner_user_id' => $owner->id(),
    ]);
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();

    $loaded = $storage->load($machine->id());
    $this->assertInstanceOf(BbMachineInterface::class, $loaded);
    $this->assertSame('dev laptop', $loaded->label());
    $this->assertSame('0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30', $loaded->uuid());
    $this->assertFalse($loaded->hasField('host_key'));
    $this->assertSame(4, $loaded->getMaxParallel());
    $this->assertSame(2, $loaded->getCurrentLoad());
    $this->assertFalse($loaded->hasField('workspace_id'));
    $this->assertSame((int) $owner->id(), (int) $loaded->get('owner_user_id')->target_id);

    $by_uuid = $storage->loadByProperties(['uuid' => $loaded->uuid()]);
    $this->assertCount(1, $by_uuid);
    $this->assertSame($loaded->id(), reset($by_uuid)->id());
  }

  /**
   * Max parallel and current load default to 1 and 0 when omitted.
   */
  public function testCapacityDefaults(): void {
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')
      ->create([
        'name' => 'defaults',
      ]);
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();
    $this->assertSame(1, $machine->getMaxParallel());
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
