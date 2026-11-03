<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Field-access on machine identity and telemetry fields.
 *
 * Name and max parallel are the product-writable fields. Host key is the
 * registration identity: writable while the row is new, frozen afterwards.
 * The saved-row allowlist hides current load, owner, created and changed
 * from ordinary editors; an instance admin still writes current load,
 * owner and created. Core's ChangedFieldItemList forbids editing changed
 * for every account. JSON:API PATCH consults field access only, never the
 * product form.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MachineFieldAccessTest extends KernelTestBase {

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
    foreach (['user', 'bb_machine'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // Uid 1 is a superuser; keep it out of the way of the assertions.
    $this->createBbUser('uid1-dummy', []);
  }

  /**
   * Creates a user with the given bakers.build permissions.
   *
   * @param string $name
   *   Username.
   * @param array<string> $perms
   *   Permission machine names to grant via a dedicated role.
   *
   * @return \Drupal\user\UserInterface
   *   The saved user.
   */
  private function createBbUser(string $name, array $perms): UserInterface {
    $role_id = 'r_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($perms) {
      user_role_grant_permissions($role_id, $perms);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a saved bb_machine owned by the given account.
   *
   * @param \Drupal\user\UserInterface $owner
   *   The machine owner.
   *
   * @return \Drupal\bb_core\Entity\BbMachineInterface
   *   The saved machine.
   */
  private function createMachine(UserInterface $owner): BbMachineInterface {
    $machine = $this->container->get('entity_type.manager')
      ->getStorage('bb_machine')
      ->create([
        'name' => 'Alpha',
        'owner_user_id' => $owner->id(),
        'max_parallel' => 4,
        'current_load' => 1,
      ]);
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();
    return $machine;
  }

  /**
   * The saved-row allowlist hides telemetry from the owner; admin writes it.
   */
  public function testTelemetryAndIdentityFieldsAreNotEditable(): void {
    $owner = $this->createBbUser('machine-owner', ['update own bb_machine']);
    $admin = $this->createBbUser('bakers-admin', ['administer bakers']);
    $machine = $this->createMachine($owner);

    foreach (['current_load', 'owner_user_id', 'created', 'changed'] as $field) {
      $this->assertFalse(
        $machine->get($field)->access('edit', $owner),
        sprintf('%s must not be editable by the owner.', $field),
      );
      $this->assertTrue(
        $machine->get($field)->access('view', $owner),
        sprintf('%s stays readable on Overview.', $field),
      );
    }
    foreach (['current_load', 'owner_user_id', 'created'] as $field) {
      $this->assertTrue(
        $machine->get($field)->access('edit', $admin),
        sprintf('%s stays writable for an instance admin.', $field),
      );
    }
    $this->assertFalse(
      $machine->get('changed')->access('edit', $admin),
      'changed is core-locked; ChangedFieldItemList forbids edit.',
    );

    foreach (['name', 'max_parallel'] as $field) {
      $this->assertTrue(
        $machine->get($field)->access('edit', $owner),
        sprintf('%s stays editable for the owner.', $field),
      );
      $this->assertTrue(
        $machine->get($field)->access('edit', $admin),
        sprintf('%s stays editable for an admin.', $field),
      );
    }
  }

}
