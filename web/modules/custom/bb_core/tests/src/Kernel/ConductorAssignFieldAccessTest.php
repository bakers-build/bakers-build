<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Field-access on bb_ticket.conductor_id.
 *
 * Assignment follows ordinary ticket update access, including unsaved tickets.
 * No separate dispatch permission is required.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorAssignFieldAccessTest extends KernelTestBase {

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
    foreach (['user', 'og_membership', 'bb_project', 'bb_conductor', 'bb_ticket', 'bb_run'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // Uid 1 is a superuser; keep it out of the way of the assertions.
    $this->createUser('uid1-dummy', []);
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
  private function createUser(string $name, array $perms): UserInterface {
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
   * Creates a saved bb_ticket.
   */
  private function createTicket(): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-CA-1', 'workflow' => 'bb_feature', 'title' => 'CA']);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Assignment needs ticket editing, on saved and unsaved entities alike.
   */
  public function testConductorIdRequiresTicketEditAccess(): void {
    $updater = $this->createUser('plain-updater', ['update any bb_ticket']);
    $reader = $this->createUser('plain-reader', ['view bb_ticket']);
    $creator = $this->createUser('create-only', ['create bb_ticket']);
    $admin = $this->createUser('bakers-admin', ['administer bakers']);
    $saved = $this->createTicket();
    $new = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['workflow' => 'bb_feature', 'title' => 'Unsaved assignment']);

    foreach ([$saved, $new] as $ticket) {
      self::assertInstanceOf(BbTicketInterface::class, $ticket);
      self::assertTrue($ticket->get('conductor_id')->access('edit', $updater));
      self::assertFalse($ticket->get('conductor_id')->access('edit', $reader));
      self::assertFalse($ticket->get('conductor_id')->access('edit', $creator));
      self::assertTrue($ticket->get('conductor_id')->access('edit', $admin));
    }
    self::assertArrayNotHasKey('assign bakers conductor', $this->container->get('user.permissions')->getPermissions());
  }

}
