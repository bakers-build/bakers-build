<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Verifies WriteScopeService and related ticket access logic.
 *
 * An active run must grant write access to the claimed ticket and its full
 * descendant tree but not to foreign tickets. Expired or terminal runs grant
 * nothing. The sub-ticket parent_id constraint enforces the scope boundary.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WriteScopeTest extends KernelTestBase {

  use OgScopeFixtureTrait;

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
      'user', 'og_membership', 'bb_group', 'bb_team', 'bb_project',
      'bb_conductor', 'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->installOgScopeFixture();
  }

  /**
   * Creates and saves a BbTicket entity with the given identifier.
   *
   * @param string $identifier
   *   Human-readable ticket identifier.
   * @param array $values
   *   Optional additional field values to merge in.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The saved ticket entity.
   */
  private function createTicket(string $identifier, array $values = []): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create($values + ['identifier' => $identifier, 'workflow' => 'bb_bug', 'title' => $identifier]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
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
    $user = $this->container->get('entity_type.manager')->getStorage('user')->create(['name' => $name, 'status' => 1]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves a conductor owned by the given account.
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
   * Verifies an active run grants write access to the claimed ticket's tree.
   *
   * Direct and indirect children are included; unrelated tickets are not.
   */
  public function testActiveRunGrantsTicketAndDescendants(): void {
    $user = $this->createUser('agent');
    $claimed = $this->createTicket('GL-10');
    $child = $this->createTicket('GL-11', ['parent_id' => $claimed->id()]);
    $grandchild = $this->createTicket('GL-12', ['parent_id' => $child->id()]);
    $foreign = $this->createTicket('GL-13');
    $conductor = $this->createConductor($user, 'agent-node');

    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $claimed->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
    ])->save();

    $allowed = $this->container->get('bb_core.write_scope')->allowedTicketIds($user);
    sort($allowed);
    $expected = [(int) $claimed->id(), (int) $child->id(), (int) $grandchild->id()];
    sort($expected);
    $this->assertSame($expected, $allowed);
    $this->assertNotContains((int) $foreign->id(), $allowed);
  }

  /**
   * Verifies that an active run grants write scope even after lease expiry.
   *
   * Scope must survive an expired claim_expires_at as long as the run is in
   * an active state (claimed/running). Lease expiry is no longer a gate.
   */
  public function testScopeSurvivesExpiredLease(): void {
    $user = $this->createUser('agent-expired');
    $ticket = $this->createTicket('GL-90');
    $conductor = $this->createConductor($user, 'agent-node-expired');
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() - 10,
    ])->save();

    $this->assertTrue($this->container->get('bb_core.write_scope')->isTicketInScope($user, (int) $ticket->id()));
  }

  /**
   * Verifies that an active run grants write scope regardless of lease expiry.
   *
   * Scope is now bound to run state, not claim_expires_at. An expired lease
   * with a running state still grants access.
   */
  public function testExpiredLeaseWithActiveRunGrantsScope(): void {
    $user = $this->createUser('agent2');
    $ticket = $this->createTicket('GL-20');
    $conductor = $this->createConductor($user, 'agent-node-2');
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() - 60,
    ])->save();

    $allowed = $this->container->get('bb_core.write_scope')->allowedTicketIds($user);
    $this->assertContains((int) $ticket->id(), $allowed);
  }

  /**
   * Verifies that a terminal run grants no write scope despite a live lease.
   */
  public function testTerminalRunGrantsNothing(): void {
    $user = $this->createUser('agent3');
    $ticket = $this->createTicket('GL-30');
    $conductor = $this->createConductor($user, 'agent-node-3');
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'done',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
    ])->save();

    $this->assertSame([], $this->container->get('bb_core.write_scope')->allowedTicketIds($user));
  }

  /**
   * Verifies scoped update access for a session-scope user.
   *
   * The user may update claimed tickets and create new ones, but must be
   * denied update access on foreign tickets.
   */
  public function testScopedUpdateAccess(): void {
    $this->createUser('uid1-dummy');
    $role_storage = $this->container->get('entity_type.manager')->getStorage('user_role');
    $role_storage->create(['id' => 'test_session_writer', 'label' => 'Test session writer'])->save();
    user_role_grant_permissions('test_session_writer', ['write bakers via session scope']);

    $agent = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'scoped-agent', 'status' => 1, 'roles' => ['test_session_writer']]);
    $agent->save();

    $claimed = $this->createTicket('GL-40');
    $foreign = $this->createTicket('GL-41');
    $conductor = $this->createConductor($agent, 'scoped-node');
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $claimed->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
    ])->save();

    $this->assertTrue($claimed->access('update', $agent));
    $this->assertFalse($foreign->access('update', $agent));
    $access = $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_ticket')->createAccess(NULL, $agent);
    $this->assertTrue($access);
  }

  /**
   * The owning conductor may write footprint metric fields; others may not.
   *
   * Footprint metrics are conductor-written at run close (BB-132), so each
   * of the six metric fields must be in CONDUCTOR_WRITABLE_FIELDS. A field
   * outside the allowlist (e.g. conductor_id) stays forbidden for a conductor
   * account.
   */
  public function testConductorMayWriteFootprintFields(): void {
    $this->createUser('uid1-dummy-fp');
    $role_storage = $this->container->get('entity_type.manager')->getStorage('user_role');
    $role_storage->create(['id' => 'conductor_role', 'label' => 'Conductor'])->save();
    user_role_grant_permissions('conductor_role', ['register bakers conductor']);

    $owner = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'conductor-owner', 'status' => 1, 'roles' => ['conductor_role']]);
    $owner->save();

    $ticket = $this->createTicket('GL-FP1');
    $conductor = $this->createConductor($owner, 'fp-node');
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'done',
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();

    foreach ([
      'tokens',
      'duration_s',
      'agent_turns',
      'tool_calls',
      'user_prompts',
      'user_prompt_words',
      'active_s',
    ] as $field) {
      $this->assertTrue(
        $run->get($field)->access('edit', $owner),
        "Owning conductor may write {$field}.",
      );
    }
    // A field outside the allowlist stays forbidden for the conductor account.
    $this->assertFalse($run->get('conductor_id')->access('edit', $owner));
  }

  /**
   * The owning conductor may write the runtime fields; a non-owner may not.
   *
   * Runtime provenance (harness, model, model_version) is written by the
   * run-owning conductor in the same close write as the footprint metrics
   * above, so the whitelist gate must behave identically for both groups.
   * The stranger holds the same `register bakers conductor` permission as the
   * owner — the field-level gate is enforced by run ownership, not by that
   * permission's presence, exactly as `testConductorMayWriteFootprintFields`
   * verifies for the pre-existing metric fields.
   */
  public function testRuntimeFieldsAreConductorWritableOnly(): void {
    $this->createUser('uid1-dummy-rt');
    $role_storage = $this->container->get('entity_type.manager')->getStorage('user_role');
    $role_storage->create(['id' => 'conductor_role_rt', 'label' => 'Conductor RT'])->save();
    user_role_grant_permissions('conductor_role_rt', ['register bakers conductor']);

    $owner = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'conductor-owner-rt', 'status' => 1, 'roles' => ['conductor_role_rt']]);
    $owner->save();
    $stranger = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'conductor-stranger-rt', 'status' => 1, 'roles' => ['conductor_role_rt']]);
    $stranger->save();

    $ticket = $this->createTicket('GL-RT1');
    $conductor = $this->createConductor($owner, 'rt-node');
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'done',
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();

    foreach (['harness', 'model', 'model_version'] as $name) {
      $this->assertTrue(
        $run->get($name)->access('edit', $owner),
        "The owning conductor may write {$name}.",
      );
      $this->assertFalse(
        $run->get($name)->access('edit', $stranger),
        "A non-owning conductor account may not write {$name}.",
      );
    }
  }

  /**
   * Verifies parent_id carries no session-scope constraint (BB-465).
   *
   * A top-level ticket (no parent), an in-scope parent, and an out-of-scope
   * parent all validate cleanly: the BbSessionScope constraint was removed
   * from parent_id because it only fired on create and was trivially
   * bypassed via update, so it obstructed the normal case without actually
   * protecting anything.
   */
  public function testSubTicketScopeConstraint(): void {
    $this->createUser('uid1-dummy2');
    $role_storage = $this->container->get('entity_type.manager')->getStorage('user_role');
    $role_storage->create(['id' => 'test_session_writer_2', 'label' => 'Test session writer 2'])->save();
    // `view bb_ticket` mirrors the workspace `app` rank, which is where this
    // permission lives now: BB-359 D6 reduced the machine roles to two
    // permissions and BB-391 D2 deleted the roles outright. The role built
    // here is a stand-in for the ACTOR, not for shipped config, so the grant
    // stays explicit. It is load-bearing
    // since BB-305: validating parent_id/ticket_id runs an access-checked
    // query through the selection handler, so an account that cannot view the
    // target reads it as "cannot be referenced" — a different violation from
    // the scope one under test.
    user_role_grant_permissions('test_session_writer_2', [
      'write bakers via session scope', 'view bb_ticket',
      // BB-318: reference validation is access-checked, and the read scope
      // narrows it to the account's OG memberships. `administer bakers` is NOT
      // the fix here — it would also bypass the write-scope constraint this
      // test exists to assert — so the agent is given a real project
      // membership below instead.
    ]);
    $agent = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => 'scoped-agent-2', 'status' => 1, 'roles' => ['test_session_writer_2']]);
    $agent->save();
    $this->container->get('current_user')->setAccount($agent);

    // Both tickets belong to a project whose team the agent is a member of, so
    // the read scope lets it reference them (BB-462 D4/D7: project
    // visibility follows team membership, not direct project OG membership,
    // which no longer exists) and the only thing that can still reject the
    // foreign parent is the write-scope constraint under test.
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')->create(['name' => 'scope-team']);
    $this->assertInstanceOf(ContentEntityInterface::class, $team);
    $team->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->create([
        'name' => 'scope-project',
        'teams' => [$team->id()],
      ]);
    $this->assertInstanceOf(ContentEntityInterface::class, $project);
    $project->save();
    $this->addMembership($team, $agent, []);
    $claimed = $this->createTicket('GL-50', ['project_id' => $project->id()]);
    $foreign = $this->createTicket('GL-51', ['project_id' => $project->id()]);
    $conductor = $this->createConductor($agent, 'scoped-node-2');
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $claimed->id(),
      'conductor_id' => $conductor->id(),
      'state' => 'running',
      'claim_expires_at' => $this->container->get('datetime.time')->getRequestTime() + 600,
    ])->save();

    $in_scope = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-52', 'workflow' => 'bb_chore', 'title' => 'Sub', 'parent_id' => $claimed->id()]);
    $this->assertInstanceOf(BbTicketInterface::class, $in_scope);
    $this->assertCount(0, $in_scope->validate()->getByField('parent_id'));

    $out_of_scope = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-53', 'workflow' => 'bb_chore', 'title' => 'Sub', 'parent_id' => $foreign->id()]);
    $this->assertInstanceOf(BbTicketInterface::class, $out_of_scope);
    $this->assertCount(0, $out_of_scope->validate()->getByField('parent_id'));

    $no_parent = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create(['identifier' => 'GL-54', 'workflow' => 'bb_chore', 'title' => 'Orphan']);
    $this->assertInstanceOf(BbTicketInterface::class, $no_parent);
    $this->assertCount(0, $no_parent->validate()->getByField('parent_id'));
  }

}
