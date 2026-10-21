<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Field-access on the server-derived bb_ticket fields (BB-392 D2/AC-5).
 *
 * `identifier`, `number` and `branch_name` are documented as read-only and
 * `base_branch` as computed, but nothing enforced it: JSON:API's PATCH path
 * consults FIELD ACCESS only (EntityResource::checkPatchFieldAccess), never
 * BaseFieldDefinition::isReadOnly(), so every one of them was accepted. The
 * stored ones persisted; the computed one was echoed back and dropped at save.
 * Denying `edit` is what turns each into the 403 naming the field that core
 * already raises for a denied field.
 *
 * `branch_name` is deliberately different: it must stay writable at CREATE —
 * that is the only way a deployment ticket carries `release/<date>-<id>` and
 * the only lever a ticket has to sit on an integration branch — and frozen
 * afterwards, which is what its own description already claims.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketDerivedFieldAccessTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    // bb_core.workspace_read_scope takes og.membership_manager, so every
    // bb_core kernel container needs og — and og needs field.
    'field', 'og',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'bb_project', 'bb_conductor', 'bb_ticket', 'bb_run'] as $type) {
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
   * Creates a saved bb_ticket.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket.
   */
  private function createTicket(): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-RO-1', 'workflow' => 'bb_feature', 'title' => 'RO']);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The server-derived fields are not editable, admin included.
   *
   * These are not privilege-gated like conductor_id: no actor authors them, so
   * a write is wrong rather than unauthorised, and it must be refused rather
   * than accepted and dropped.
   */
  public function testDerivedFieldsAreNotEditable(): void {
    $ticket = $this->createTicket();
    $updater = $this->createBbUser('plain-updater', ['update bb_ticket']);
    $admin = $this->createBbUser('bakers-admin', ['administer bakers']);

    foreach (['base_branch', 'identifier', 'number', 'branch_name'] as $field) {
      $this->assertFalse(
        $ticket->get($field)->access('edit', $updater),
        sprintf('%s must not be editable by a plain updater.', $field),
      );
      $this->assertFalse(
        $ticket->get($field)->access('edit', $admin),
        sprintf('%s must not be editable by an admin either.', $field),
      );
    }

    // Control: an ordinary field stays editable for both.
    $this->assertTrue($ticket->get('title')->access('edit', $updater), 'title stays editable.');
    $this->assertTrue($ticket->get('title')->access('edit', $admin), 'title stays editable for admin.');
  }

  /**
   * The branch_name is writable while the ticket is new, frozen once saved.
   */
  public function testBranchNameIsWritableAtCreateOnly(): void {
    $updater = $this->createBbUser('create-updater', ['update bb_ticket', 'create bb_ticket']);
    $new = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-RO-2', 'workflow' => 'bb_feature', 'title' => 'RO2']);
    $this->assertInstanceOf(BbTicketInterface::class, $new);

    $this->assertTrue(
      $new->get('branch_name')->access('edit', $updater),
      'branch_name must stay settable on a ticket that has not been saved yet.',
    );

    $new->set('branch_name', 'd11-test-site');
    $new->save();
    $this->assertSame('d11-test-site', $new->get('branch_name')->value, 'A supplied branch_name survives the first save.');
    $this->assertFalse(
      $new->get('branch_name')->access('edit', $updater),
      'branch_name must be frozen once the ticket exists.',
    );
  }

}
