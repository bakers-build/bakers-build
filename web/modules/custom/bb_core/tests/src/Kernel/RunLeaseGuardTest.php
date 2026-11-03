<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies BbConductor and BbRun access control and validation guards.
 *
 * Checks that ownership rules, field-level write allowlists, lease-expiry
 * checks, and terminal-state locks are correctly enforced.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunLeaseGuardTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image',
    'link', 'text', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   *
   * Core's own service provider only registers the `private` stream wrapper
   * when `file_private_path` is already set at container-build time, which is
   * before this test's setUp() gets a chance to call setSetting().
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->register('stream_wrapper.private', 'Drupal\Core\StreamWrapper\PrivateStream')
      ->addTag('stream_wrapper', ['scheme' => 'private']);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $entity_types = [
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_run', 'file',
    ];
    foreach ($entity_types as $type) {
      $this->installEntitySchema($type);
    }
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installConfig(['user']);
    $this->createUser('uid1-dummy');
  }

  /**
   * Creates a Drupal user with the conductor permissions needed for testing.
   *
   * @param string $name
   *   Username for the new account.
   *
   * @return \Drupal\user\UserInterface
   *   The saved user entity.
   */
  private function createConductorUser(string $name): UserInterface {
    $role_id = 'conductor_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, ['register bakers conductor', 'claim bakers tickets']);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a plain Drupal user without special permissions.
   *
   * @param string $name
   *   Username for the new account.
   *
   * @return \Drupal\user\UserInterface
   *   The saved user entity.
   */
  private function createUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a BbConductor entity owned by the given user.
   *
   * @param \Drupal\user\UserInterface $owner
   *   The owning user account.
   * @param string $machine_id
   *   Unique machine identifier for the conductor node.
   *
   * @return \Drupal\bb_core\Entity\BbConductorInterface
   *   The saved conductor entity.
   */
  private function createConductor(UserInterface $owner, string $machine_id): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'label' => $machine_id,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates and saves a minimal BbTicket entity with the given identifier.
   *
   * @param string $identifier
   *   Human-readable ticket identifier.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket entity.
   */
  private function createTicket(string $identifier): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => $identifier, 'workflow' => 'bb_work', 'title' => $identifier]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Creates and saves a BbRun with a fresh ticket and a configurable lease.
   *
   * @param string $state
   *   Initial run state (e.g. 'claimed', 'running', 'done').
   * @param int $expires_offset
   *   Seconds relative to the current request time for the lease expiry.
   *   Negative values produce an already-expired lease.
   * @param \Drupal\bb_core\Entity\BbConductorInterface|null $conductor
   *   Optional conductor to attach to the run.
   *
   * @return \Drupal\bb_core\Entity\BbRunInterface
   *   The saved run entity.
   */
  private function createRun(string $state, int $expires_offset, ?BbConductorInterface $conductor = NULL): BbRunInterface {
    $ticket = $this->createTicket('GL-LG-' . $state . '-' . $expires_offset . '-' . mt_rand());
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor?->id(),
      'state' => $state,
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + $expires_offset,
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    return $run;
  }

  /**
   * Verifies that a conductor owner can update only their own conductor.
   *
   * Also checks that the owner is allowed to create new conductors.
   */
  public function testConductorAccessOwnRegistrationOnly(): void {
    $owner = $this->createConductorUser('node-owner');
    $other = $this->createConductorUser('other-owner');
    $conductor = $this->createConductor($owner, 'node-a');

    $this->assertTrue($conductor->access('update', $owner));
    $this->assertFalse($conductor->access('update', $other));
    $create = $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_conductor')->createAccess(NULL, $owner);
    $this->assertTrue($create);
  }

  /**
   * Verifies that owner_user_id must match the current user and is immutable.
   *
   * Checks that the field is locked at creation time and cannot be changed.
   */
  public function testConductorOwnerEnforcedOnCreateAndLocked(): void {
    $owner = $this->createConductorUser('owner-enforced');
    $other = $this->createConductorUser('owner-foreign');
    $this->container->get('current_user')->setAccount($owner);

    $foreign = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'label' => 'Foreign',
      'owner_user_id' => $other->id(),
    ]);
    $this->assertInstanceOf(BbConductorInterface::class, $foreign);
    $this->assertGreaterThan(0, count($foreign->validate()->getByField('owner_user_id')));

    $own = $this->createConductor($owner, 'node-own');
    $this->assertCount(0, $own->validate()->getByField('owner_user_id'));

    $own->set('owner_user_id', $other->id());
    $this->assertGreaterThan(0, count($own->validate()->getByField('owner_user_id')));
  }

  /**
   * Verifies that a conductor owner can update only their own run.
   *
   * Checks that another user is denied entity-level and field-level access.
   */
  public function testRunAccessOwnRunsOnly(): void {
    $owner = $this->createConductorUser('run-owner');
    $other = $this->createConductorUser('run-other');
    $conductor = $this->createConductor($owner, 'node-b');
    $run = $this->createRun('claimed', 600, $conductor);

    $this->assertTrue($run->access('update', $owner));
    $this->assertFalse($run->access('update', $other));
    $this->assertFalse($run->get('state')->access('edit', $other));
  }

  /**
   * Verifies the run field edit allowlist for conductor owners.
   *
   * Checks that state, claim_expires_at, started_at, heartbeat, worktree_path,
   * agent, log, log_upload_omitted, and the closure pair (closed, closed_date)
   * are editable, and that immutable fields (ticket_id, conductor_id,
   * state_at_start) are not.
   */
  public function testRunFieldAccessAllowlist(): void {
    $owner = $this->createConductorUser('field-owner');
    $conductor = $this->createConductor($owner, 'node-fields');
    $run = $this->createRun('claimed', 600, $conductor);

    $editable = [
      'state', 'claim_expires_at', 'started_at', 'heartbeat',
      'worktree_path', 'agent', 'log', 'log_upload_omitted',
      'closed', 'closed_date',
    ];
    foreach ($editable as $field) {
      $this->assertTrue($run->get($field)->access('edit', $owner), "$field must be editable.");
    }
    foreach (['ticket_id', 'conductor_id', 'state_at_start'] as $field) {
      $this->assertFalse($run->get($field)->access('edit', $owner), "$field must not be editable.");
    }
  }

  /**
   * Verifies that the heartbeat field is writable by the owning conductor only.
   *
   * A conductor account that owns the run must be able to edit heartbeat.
   * A different conductor account must be denied field-level write access.
   */
  public function testHeartbeatWritableByOwnerNotByOther(): void {
    $owner = $this->createConductorUser('hb-owner');
    $other = $this->createConductorUser('hb-other');
    $conductor = $this->createConductor($owner, 'node-hb');
    $run = $this->createRun('running', 600, $conductor);

    $this->assertTrue($run->get('heartbeat')->access('edit', $owner), 'Owner must be able to write heartbeat.');
    $this->assertFalse($run->get('heartbeat')->access('edit', $other), 'Non-owner must not be able to write heartbeat.');
  }

  /**
   * Verifies a terminal run cannot be transitioned back to an active state.
   */
  public function testTerminalRunCannotBeReactivated(): void {
    $user = $this->createConductorUser('lease-terminal');
    $this->container->get('current_user')->setAccount($user);
    $run = $this->createRun('done', 600);

    $run->setRunState('running');
    $this->assertGreaterThan(0, count($run->validate()->getByField('state')));
  }

  /**
   * Verifies that transitioning a claimed run with an expired lease is allowed.
   *
   * Lease expiry is no longer a validation gate; run existence blocks
   * re-claim instead. Transitioning an expired-lease claimed run to running
   * must not produce any violations.
   */
  public function testExpiredLeaseActiveTransitionAllowed(): void {
    $user = $this->createConductorUser('lease-expired');
    $this->container->get('current_user')->setAccount($user);
    $run = $this->createRun('claimed', -60);

    $run->setRunState('running');
    $run->set('claim_expires_at', $this->container->get('datetime.time')->getRequestTime() + 600);
    $this->assertCount(0, $run->validate()->getByField('state'));
  }

  /**
   * Verifies that an active run re-saved after its lease expires passes.
   *
   * Run existence (not claim_expires_at) is the new dispatch-lock; saving a
   * still-running run after lease expiry must not fail with messageExpired.
   */
  public function testExpiredActiveRunCanBeSaved(): void {
    $user = $this->createConductorUser('lease-expired-save');
    $this->container->get('current_user')->setAccount($user);
    // Run in state 'running' with claim_expires_at in the past.
    $run = $this->createRun('running', -10);

    // Re-save the same active state after lease expiry must NOT fail.
    $run->set('worktree_path', '/tmp/wt');
    $violations = $run->validate();
    $this->assertCount(0, $violations, (string) $violations);
  }

  /**
   * Verifies that a run with an active lease can be renewed without violations.
   */
  public function testActiveLeaseRenewAllowed(): void {
    $user = $this->createConductorUser('lease-active');
    $this->container->get('current_user')->setAccount($user);
    $run = $this->createRun('claimed', 600);

    $run->setRunState('running');
    $run->set('claim_expires_at', $this->container->get('datetime.time')->getRequestTime() + 1200);
    $this->assertCount(0, $run->validate()->getByField('state'));
  }

  /**
   * Verifies that a run with an expired lease can be transitioned to done.
   */
  public function testExpiredRunMayBeDone(): void {
    $user = $this->createConductorUser('lease-release');
    $this->container->get('current_user')->setAccount($user);
    $run = $this->createRun('running', -60);

    $run->setRunState('done');
    $this->assertCount(0, $run->validate()->getByField('state'));
  }

}
