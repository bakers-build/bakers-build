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
 * Verifies the terminal-ticket cleanup access grant on BbTicket.
 *
 * A session-scoped writer may wind up a TERMINAL ticket outside any active
 * run's scope — the conductor's cleanup pass. The state being terminal (done or
 * cancelled, derived from bb_core.workflows.yml) or the ticket being already
 * closed is the only gate: no ownership, no extra permission. Since BB-451
 * the permitted field is `cleaned_up` alone, on EVERY terminal ticket: the
 * server now closes a terminal ticket on its own save
 * (BbTicket::preSave()), so the reaper has no remaining business writing
 * `closed`/`closed_date`, and the grant is narrowed to match — this is the
 * hard form of "reaping never sets `closed` as a side effect". Every other
 * field stays forbidden, NON-terminal tickets are not writable this way, and
 * since BB-588 a closed ticket is frozen for in-scope writers too.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketConductorCleanupAccessTest extends KernelTestBase {

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
    // uid1 is a superuser; keep it out of the way.
    $this->createBareUser('uid1-dummy');
  }

  /**
   * Creates a user with administer bakers.
   */
  private function createAdminUser(string $name): UserInterface {
    $role_id = 'adm_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, ['administer bakers']);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a user with the session-scoped write permission.
   */
  private function createSessionUser(string $name): UserInterface {
    $role_id = 'sess_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    user_role_grant_permissions($role_id, [
      'write bakers via session scope',
      'view bb_ticket',
    ]);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates a plain user with no special permissions.
   */
  private function createBareUser(string $name): UserInterface {
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a conductor owned by the given user.
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
   * Creates and saves a ticket in the given workflow state.
   */
  private function createTicket(string $identifier, string $state): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'workflow' => 'bb_work',
        'title' => $identifier,
        'state' => $state,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
  }

  /**
   * Marks a ticket closed by a raw column write, bypassing preSave().
   *
   * The closed-implies-terminal invariant would cancel the ticket on save, so
   * the stored-closed / still-non-terminal shape the admin correction path
   * unlocks is only reachable through a write that skips presave logic.
   */
  private function forceClosed(BbTicketInterface $ticket): BbTicketInterface {
    $this->container->get('database')->update('bb_ticket')
      ->fields(['closed' => 1])
      ->condition('id', $ticket->id())
      ->execute();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([(int) $ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Forces a ticket back open by a raw column write, bypassing preSave().
   *
   * Since BB-451, BbTicket::preSave() closes a terminal ticket on its own
   * save, so a plain create()+save() of a `cancelled` fixture no longer stays
   * open — the case the terminal-state (not `closed`) access grant exists for
   * is now reachable only through a write that skips presave logic.
   */
  private function forceOpen(BbTicketInterface $ticket): BbTicketInterface {
    $this->container->get('database')->update('bb_ticket')
      ->fields(['closed' => 0, 'closed_date' => NULL])
      ->condition('id', $ticket->id())
      ->execute();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([(int) $ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * A session writer may update a done ticket out of scope (entity-level).
   */
  public function testSessionMayUpdateDoneTicket(): void {
    $user = $this->createSessionUser('cleanup-done');
    $ticket = $this->createTicket('GL-CU-1', 'done');

    $this->assertTrue($ticket->access('update', $user));
  }

  /**
   * On a done ticket out of scope, only `cleaned_up` is editable (BB-451).
   *
   * `closed`/`closed_date` are OFF the allowlist now that the server closes a
   * terminal ticket on its own save: a session-scoped writer outside any run
   * scope may no longer write them at all, on `done` or on any other
   * terminal state — the reaper keeps only the infrastructure teardown flag.
   */
  public function testCleanupFieldAllowlist(): void {
    $user = $this->createSessionUser('cleanup-fields');
    $ticket = $this->createTicket('GL-CU-2', 'done');

    $this->assertTrue($ticket->get('cleaned_up')->access('edit', $user), 'cleaned_up must be editable.');
    foreach (['title', 'state', 'description', 'closed', 'closed_date', 'environments'] as $field) {
      $this->assertFalse($ticket->get($field)->access('edit', $user), "$field must not be editable.");
    }
  }

  /**
   * Metrics stay writable on a closed ticket until its worktree is reaped.
   *
   * The reaper records the merge-request measurement before teardown; once
   * `cleaned_up` is set, the ticket is frozen again.
   */
  public function testMetricsWritableUntilCleanedUp(): void {
    $user = $this->createSessionUser('cleanup-metrics');
    $ticket = $this->createTicket('GL-CU-12', 'done');

    $this->assertTrue($ticket->isClosed());
    $this->assertTrue($ticket->get('metrics')->access('edit', $user), 'metrics must be editable before cleanup.');
    $this->assertFalse($ticket->get('title')->access('edit', $user), 'title stays frozen.');

    $ticket->set('cleaned_up', TRUE)->save();
    $this->assertFalse($ticket->get('metrics')->access('edit', $user), 'metrics must be frozen after cleanup.');
  }

  /**
   * A ticket that is NOT done is not writable via the cleanup grant.
   */
  public function testNonDoneTicketNotWritable(): void {
    $user = $this->createSessionUser('cleanup-notdone');
    $ticket = $this->createTicket('GL-CU-3', 'coding');

    $this->assertFalse($ticket->access('update', $user));
  }

  /**
   * A closed cancelled ticket permits only the infrastructure cleanup flag.
   */
  public function testClosedCancelledTicketMayBeMarkedCleanedUp(): void {
    $user = $this->createSessionUser('cleanup-cancelled');
    $ticket = $this->createTicket('GL-CU-6', 'cancelled');
    $ticket->set('closed', TRUE)->save();

    $this->assertTrue($ticket->access('update', $user));
    $this->assertTrue($ticket->get('cleaned_up')->access('edit', $user));
    $this->assertFalse($ticket->get('closed')->access('edit', $user));
    $this->assertFalse($ticket->get('closed_date')->access('edit', $user));
    $this->assertFalse($ticket->get('title')->access('edit', $user));
  }

  /**
   * An OPEN cancelled ticket permits only the infrastructure cleanup flag.
   *
   * The reaper reclaims a cancelled ticket's worktree without ever closing it
   * (BB-243): a cancelled ticket keeps closed=0, so the grant has to come
   * from the state being terminal, not from `closed`. The field allowlist is
   * still the narrow one — cleaned_up and nothing else.
   */
  public function testOpenCancelledTicketMayBeMarkedCleanedUp(): void {
    $user = $this->createSessionUser('cleanup-cancelled-open');
    $ticket = $this->forceOpen($this->createTicket('GL-CU-7', 'cancelled'));

    $this->assertFalse($ticket->isClosed(), 'The fixture must stay open to test the terminal-state grant.');
    $this->assertTrue($ticket->access('update', $user));
    $this->assertTrue($ticket->get('cleaned_up')->access('edit', $user), 'cleaned_up must be editable.');
    $this->assertFalse($ticket->get('closed')->access('edit', $user), 'closed must not be editable.');
    $this->assertFalse($ticket->get('closed_date')->access('edit', $user), 'closed_date must not be editable.');
    $this->assertFalse($ticket->get('title')->access('edit', $user), 'title must not be editable.');
  }

  /**
   * The cleanup grant on a cancelled ticket never opens up `state`.
   *
   * Reaping a cancelled ticket must leave it cancelled — it is never pushed to
   * done. The conductor has no code path that writes state here, and this
   * pins the same guarantee at the gate, so a buggy client cannot either.
   */
  public function testOpenCancelledTicketRejectsStateWrite(): void {
    $user = $this->createSessionUser('cleanup-cancelled-state');
    $ticket = $this->createTicket('GL-CU-8', 'cancelled');

    $this->assertFalse($ticket->get('state')->access('edit', $user), 'state must not be editable.');
  }

  /**
   * A user without the session-scope permission cannot close a done ticket.
   */
  public function testUserWithoutPermissionDenied(): void {
    $user = $this->createBareUser('cleanup-noperm');
    $ticket = $this->createTicket('GL-CU-4', 'done');

    $this->assertFalse($ticket->access('update', $user));
  }

  /**
   * A closed ticket is frozen even for a writer whose run is still in scope.
   *
   * Closed means nothing is edited any more; only the reaper's `cleaned_up`
   * stays writable. An in-scope run on a done ticket is not a regular path —
   * the done transition retires the run — so it gains no field either.
   */
  public function testInScopeWritesOnClosedTicketsAreFrozen(): void {
    $user = $this->createSessionUser('in-scope');
    $conductor = $this->createConductor($user, 'node-scope');
    $ticket = $this->createTicket('GL-CU-5', 'done');
    // An active run on the ticket puts it in the account's write scope.
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
    ]);
    $run->save();

    $this->assertTrue($ticket->access('update', $user));
    $this->assertFalse($ticket->get('title')->access('edit', $user), 'A closed ticket\'s title is frozen.');
    $this->assertFalse($ticket->get('environments')->access('edit', $user), 'A closed ticket\'s environments are frozen.');
    $this->assertTrue($ticket->get('cleaned_up')->access('edit', $user), 'The cleanup flag stays writable.');
  }

  /**
   * An administrator may edit `state` on a closed non-terminal ticket.
   *
   * The freeze still holds for every other field; saving `state` through this
   * unlock is what the closed-implies-terminal invariant then heals.
   */
  public function testAdminMayEditStateOnClosedNonTerminalTicket(): void {
    $admin = $this->createAdminUser('admin-correct');
    $ticket = $this->forceClosed($this->createTicket('GL-CU-9', 'qualification'));

    $this->assertTrue($ticket->isClosed());
    $this->assertSame('qualification', (string) $ticket->get('state')->value);
    $this->assertTrue($ticket->get('state')->access('edit', $admin), 'administer bakers may correct state.');
    $this->assertFalse($ticket->get('title')->access('edit', $admin), 'title stays frozen on a closed ticket.');
  }

  /**
   * Session writers cannot edit state on a closed non-terminal ticket.
   */
  public function testSessionWriterCannotEditStateOnClosedNonTerminalTicket(): void {
    $user = $this->createSessionUser('sess-closed-nt');
    $ticket = $this->forceClosed($this->createTicket('GL-CU-10', 'qualification'));

    $this->assertFalse($ticket->get('state')->access('edit', $user));
  }

  /**
   * A closed terminal ticket stays frozen, including for administer bakers.
   */
  public function testAdminCannotEditStateOnClosedTerminalTicket(): void {
    $admin = $this->createAdminUser('admin-frozen');
    $session = $this->createSessionUser('sess-closed-term');
    $ticket = $this->createTicket('GL-CU-11', 'done');

    $this->assertTrue($ticket->isClosed());
    $this->assertFalse($ticket->get('state')->access('edit', $admin));
    $this->assertFalse($ticket->get('state')->access('edit', $session));
  }

}
