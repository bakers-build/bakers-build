<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * View field-access on the `recipient_profile` field.
 *
 * The field's value is derived for the ticket's assignee specifically (their
 * onboarding profile — BB-432), so it must be readable by the assignee only,
 * not by every account that can otherwise view the ticket.
 *
 * @group bb_core
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RecipientProfileAccessTest extends KernelTestBase {

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
   * Creates a saved bb_ticket assigned to the given user.
   */
  private function createTicket(UserInterface $assignee): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => 'GL-RP-1',
        'workflow' => 'bb_work',
        'title' => 'Recipient profile access',
        'assignee_user_id' => $assignee->id(),
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * The assignee reads the field; a mere ticket viewer reads the empty string.
   */
  public function testOnlyTheAssigneeReadsRecipientProfile(): void {
    $assignee = $this->createUser('rp-assignee', ['view bb_ticket']);
    $viewer = $this->createUser('rp-viewer', ['view bb_ticket', 'update any bb_ticket']);
    $ticket = $this->createTicket($assignee);

    $this->assertTrue(
      $ticket->get('recipient_profile')->access('view', $assignee),
      'The assignee must be able to view their own recipient_profile field.',
    );

    // Reset access-controlled entity/field access cache between accounts.
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->assertFalse(
      $ticket->get('recipient_profile')->access('view', $viewer),
      'A non-assignee with full ticket view access must not read recipient_profile.',
    );
  }

}
