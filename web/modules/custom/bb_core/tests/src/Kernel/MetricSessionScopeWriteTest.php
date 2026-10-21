<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies a session-scoped writer may set ticket metrics (BB-172 AC-2).
 *
 * A session write to an in-scope ticket is already allowed by
 * BbTicketAccessControlHandler; the metrics field falls through
 * checkFieldAccess (which gates only conductor_id / env_vars / done-closure),
 * so an agent may PATCH metrics with NO new permission. An out-of-scope ticket
 * is denied.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MetricSessionScopeWriteTest extends KernelTestBase {

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
      'user', 'og_membership', 'bb_group', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    // Uid 1 is a superuser; keep it out of the way of the scoped account.
    $this->createUser('uid1-dummy');
    $role_storage = $this->container->get('entity_type.manager')->getStorage('user_role');
    $role_storage->create(['id' => 'test_session_writer', 'label' => 'Test session writer'])->save();
    user_role_grant_permissions('test_session_writer', ['write bakers via session scope']);
  }

  /**
   * Creates and saves a minimal ticket.
   */
  private function createTicket(string $identifier): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => $identifier, 'workflow' => 'bb_feature', 'title' => $identifier]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates a plain user.
   */
  private function createUser(string $name, array $roles = []): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => $roles]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a conductor owned by the account.
   */
  private function createConductor(UserInterface $owner, string $machine_id): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $machine_id,
      'label' => $machine_id,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Opens an active run for the account claiming the ticket.
   */
  private function claim(UserInterface $account, BbTicketInterface $ticket, string $machine_id): void {
    $conductor = $this->createConductor($account, $machine_id);
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
    ])->save();
  }

  /**
   * A session may write metrics onto an in-scope ticket — no new permission.
   */
  public function testSessionScopeMayWriteMetricsInScope(): void {
    $agent = $this->createUser('scoped-agent', ['test_session_writer']);
    $ticket = $this->createTicket('GL-200');
    $this->claim($agent, $ticket, 'scoped-node');

    $ticket->set('metrics', [['name' => 'ac_pass_rate', 'value' => '0.8000', 'unit' => 'ratio']]);
    $this->assertTrue($ticket->access('update', $agent));
    $this->assertTrue($ticket->get('metrics')->access('edit', $agent));
  }

  /**
   * A session may NOT write metrics onto an out-of-scope ticket.
   */
  public function testSessionScopeMayNotWriteMetricsOutOfScope(): void {
    $agent = $this->createUser('scoped-agent-2', ['test_session_writer']);
    $claimed = $this->createTicket('GL-201');
    $foreign = $this->createTicket('GL-202');
    $this->claim($agent, $claimed, 'scoped-node-2');

    $this->assertFalse($foreign->access('update', $agent));
  }

}
