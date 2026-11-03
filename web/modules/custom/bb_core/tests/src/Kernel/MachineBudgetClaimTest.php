<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Claim\TicketClaimService;
use Drupal\Core\Lock\DatabaseLockBackend;
use Drupal\bb_core\Claim\ClaimConflictException;
use Drupal\bb_core\Claim\MachineCapacityException;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * BB-464: the machine budget must bound what the claim API admits.
 *
 * The claim endpoint is the one place every claim on a host is serialised, and
 * it performs no capacity check at all — `assertEligible()` validates state,
 * project, conductor assignment, blockers and the circuit breaker, and nothing
 * reads `bb_machine.max_parallel`. The budget therefore lives entirely in
 * each client, over a value the client knows is stale, which makes it
 * advisory.
 *
 * These tests drive the service directly, with no client involved, so a failure
 * here is unambiguous: it is the control plane admitting runs the host cannot
 * carry, not a conductor mis-reading a load.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MachineBudgetClaimTest extends KernelTestBase {

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
   * The project every fixture belongs to.
   */
  private int $projectId;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_group', 'bb_workspace', 'bb_project',
      'bb_machine', 'bb_conductor', 'bb_ticket', 'bb_comment',
      'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
    $this->createConductorUser('uid1-dummy');

    $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'test-workspace', 'slug' => 'test-workspace'])
      ->save();

    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->create(['name' => 'default-project']);
    $project->save();
    $this->projectId = (int) $project->id();
  }

  /**
   * Creates a user allowed to register conductors and claim tickets.
   */
  private function createConductorUser(string $name): UserInterface {
    $role_id = 'conductor_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    // `administer bakers` lets the owner work in any project
    // (BbConductorOwnerAccess); ConductorOwnerAccessTest covers the rule.
    user_role_grant_permissions($role_id, ['register bakers conductor', 'claim bakers tickets', 'administer bakers']);
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    $this->assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates the shared host row carrying the budget.
   */
  private function createMachine(UserInterface $owner, string $hostKey, int $maxParallel): BbMachineInterface {
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')
      ->create([
        'name' => $hostKey,
        'owner_user_id' => $owner->id(),
        'max_parallel' => $maxParallel,
        'current_load' => 0,
      ]);
    $this->assertInstanceOf(BbMachineInterface::class, $machine);
    $machine->save();
    return $machine;
  }

  /**
   * Creates an online conductor linked to the shared machine.
   */
  private function createConductor(UserInterface $owner, string $conductorId, BbMachineInterface $machine): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')
      ->create([
        'label' => $conductorId,
        'owner_user_id' => $owner->id(),
        'status' => 'online',
        'project_id' => $this->projectId,
        'states' => ['plan', 'working'],
        'machine' => $machine->id(),
        'reported_load' => 0,
        'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
      ]);
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates a claimable ticket assigned to the given conductor.
   */
  private function createAssignedTicket(string $identifier, BbConductorInterface $conductor): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')
      ->create([
        'identifier' => $identifier,
        'workflow' => 'bb_work',
        'title' => $identifier,
        'project_id' => $this->projectId,
      ]);
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->set('conductor_id', $conductor->id())->save();
    return $ticket;
  }

  /**
   * Returns the claim service.
   */
  private function claimService(): TicketClaimService {
    return $this->container->get('bb_core.ticket_claim');
  }

  /**
   * Reloads a conductor so its machine reference sees a just-saved budget.
   */
  private function reloadConductor(BbConductorInterface $conductor): BbConductorInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_conductor');
    $storage->resetCache([$conductor->id()]);
    $this->container->get('entity_type.manager')->getStorage('bb_machine')
      ->resetCache([(int) $conductor->get('machine')->target_id]);
    $fresh = $storage->load($conductor->id());
    $this->assertInstanceOf(BbConductorInterface::class, $fresh);
    return $fresh;
  }

  /**
   * Occupants on a different machine do not consume this host's budget.
   */
  public function testOtherMachineDoesNotConsumeCapacity(): void {
    $owner = $this->createConductorUser('other-machine-owner');
    $first = $this->createConductor($owner, 'first-host', $this->createMachine($owner, 'first', 1));
    $second = $this->createConductor($owner, 'second-host', $this->createMachine($owner, 'second', 1));
    $this->claimService()->claim($this->createAssignedTicket('OTHER-FIRST', $first), $first);
    $target = $this->createAssignedTicket('OTHER-SECOND', $second);
    $this->assertSame((int) $target->id(), $this->claimService()->claimNext($second)?->getTicketId());
  }

  /**
   * A competing admission lock prevents count-and-mint from overlapping.
   */
  public function testConcurrentMachineAdmissionIsExcluded(): void {
    $owner = $this->createConductorUser('lock-owner');
    $machine = $this->createMachine($owner, 'locked', 1);
    $conductor = $this->createConductor($owner, 'locked-host', $machine);
    $target = $this->createAssignedTicket('LOCKED-TARGET', $conductor);
    // Kernel tests default to a null lock; use independent real lock owners.
    $this->container->set('lock', new DatabaseLockBackend($this->container->get('database')));
    $this->container->set('bb_core.ticket_claim', NULL);
    $peer = new DatabaseLockBackend($this->container->get('database'));
    $name = 'bb_machine:' . $machine->id();
    $this->assertTrue($peer->acquire($name));
    try {
      $this->claimService()->claim($target, $conductor);
      $this->fail('A competing claim holds the admission lock.');
    }
    catch (ClaimConflictException $e) {
      $this->assertSame('claim_conflict: machine is being claimed concurrently.', $e->getMessage());
    }
    finally {
      $peer->release($name);
    }
    $this->assertSame((int) $target->id(), $this->claimService()->claimNext($conductor)?->getTicketId());
    $this->assertNull($this->claimService()->claimNext($conductor));
  }

  /**
   * Counts the machine's live runs — the figure the budget must bound.
   *
   * A `claimed` run whose lease has already lapsed is excluded, mirroring
   * `TicketClaimService::countLiveRunsOnMachine()`: it is an abandoned claim,
   * not a live occupant of a budget slot (BB-464 AC 6).
   */
  private function liveRunsOnMachine(BbMachineInterface $machine): int {
    $etm = $this->container->get('entity_type.manager');
    $conductorIds = $etm->getStorage('bb_conductor')->getQuery()
      ->accessCheck(FALSE)
      ->condition('machine', $machine->id())
      ->execute();
    if ($conductorIds === []) {
      return 0;
    }
    $now = $this->container->get('datetime.time')->getRequestTime();
    $storage = $etm->getStorage('bb_run');
    $query = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductor_id', $conductorIds, 'IN');
    $live = $query->orConditionGroup()
      ->condition('state', 'running')
      ->condition($query->andConditionGroup()
        ->condition('state', 'claimed')
        ->condition($query->orConditionGroup()
          ->condition('claim_expires_at', 0)
          ->condition('claim_expires_at', $now, '>=')));
    return (int) $query->condition($live)->count()->execute();
  }

  /**
   * Two conductors on one machine may not exceed the machine's budget.
   *
   * Sequential, not concurrent: each claim is fully committed before the next
   * begins, so there is no window left for a race to explain the overshoot.
   */
  public function testSecondConductorCannotExceedMachineBudget(): void {
    $owner = $this->createConductorUser('budget-owner');
    $machine = $this->createMachine($owner, 'dev-box', 1);
    $shop = $this->createConductor($owner, 'cw-dev-box-shop', $machine);
    $bibb = $this->createConductor($owner, 'cw-dev-box-bibb', $machine);

    $this->claimService()->claim($this->createAssignedTicket('GL-SHOP-1', $shop), $shop);
    $this->assertSame(1, $this->liveRunsOnMachine($machine), 'first claim fills the budget');

    // The host is full. The control plane must refuse the second claim.
    $second = $this->createAssignedTicket('GL-BIBB-1', $bibb);
    try {
      $this->claimService()->claim($second, $bibb);
    }
    catch (\Throwable) {
      // A refusal is the expected outcome.
    }

    $this->assertLessThanOrEqual(
      $machine->getMaxParallel(),
      $this->liveRunsOnMachine($machine),
      'the machine carries more live runs than its budget allows',
    );
  }

  /**
   * A single conductor may not exceed the machine budget on its own either.
   *
   * The `claimNext()` loop tries candidates until one succeeds; with no
   * capacity gate the caller is free to call it as often as it likes, so the
   * budget binds only if the service itself refuses.
   */
  public function testClaimNextStopsAtTheMachineBudget(): void {
    $owner = $this->createConductorUser('budget-owner-single');
    $machine = $this->createMachine($owner, 'solo-box', 1);
    $conductor = $this->createConductor($owner, 'cw-solo-box-bakers', $machine);

    $this->createAssignedTicket('GL-SOLO-1', $conductor);
    $this->createAssignedTicket('GL-SOLO-2', $conductor);

    $this->claimService()->claimNext($conductor);
    $this->claimService()->claimNext($conductor);

    $this->assertLessThanOrEqual(
      $machine->getMaxParallel(),
      $this->liveRunsOnMachine($machine),
      'claimNext minted runs past the machine budget',
    );
  }

  /**
   * A crashed conductor's abandoned claim frees its budget slot on expiry.
   *
   * The ceiling must count LIVE runs, not `reported_load` — a hard ceiling
   * built on the latter would re-open the BB-63 lock-out: a crashed
   * conductor's last reported load keeps counting until the reaper flips its
   * status, potentially forever. Here the machine's budget of 1 is filled by
   * a `claimed` run whose lease has already lapsed and whose conductor is
   * gone; the next claim on that machine, by a DIFFERENT, healthy conductor,
   * must succeed — nothing on that healthy conductor's own claimNext() ever
   * reaps a stale claim belonging to another conductor (BB-464 AC 6).
   */
  public function testAbandonedClaimFreesMachineBudgetOnExpiry(): void {
    $owner = $this->createConductorUser('budget-owner-expiry');
    $machine = $this->createMachine($owner, 'expiry-box', 1);
    $crashed = $this->createConductor($owner, 'cw-expiry-box-crashed', $machine);
    $healthy = $this->createConductor($owner, 'cw-expiry-box-healthy', $machine);

    $zombie_ticket = $this->createAssignedTicket('GL-CRASHED-1', $crashed);
    $now = $this->container->get('datetime.time')->getRequestTime();
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $zombie_ticket->id(),
      'conductor_id' => $crashed->id(),
      'owner_user_id' => $owner->id(),
      'state' => 'claimed',
      'claim_expires_at' => $now - 10,
      'state_at_start' => 'working',
      'started_at' => $now - 100,
    ])->save();

    $next = $this->createAssignedTicket('GL-HEALTHY-1', $healthy);
    $run = $this->claimService()->claim($next, $healthy);

    $this->assertSame('claimed', $run->getRunState());
    $this->assertLessThanOrEqual(
      $machine->getMaxParallel(),
      $this->liveRunsOnMachine($machine),
      'the machine still carries the abandoned zombie against its budget',
    );
  }

  /**
   * An owner budget raise admits a later claim.
   *
   * Lowering below usage refuses new claims without retiring live runs.
   */
  public function testOwnerBudgetEditThenLowerBelowUsage(): void {
    $owner = $this->createConductorUser('budget-edit-owner');
    $machine = $this->createMachine($owner, 'edit-box', 1);
    $conductor = $this->createConductor($owner, 'cw-edit-box-bakers', $machine);

    $this->claimService()->claim(
      $this->createAssignedTicket('GL-EDIT-1', $conductor),
      $conductor,
    );
    $this->assertSame(1, $this->liveRunsOnMachine($machine));

    $machine->setMaxParallel(2)->save();
    $conductor = $this->reloadConductor($conductor);
    $second = $this->claimService()->claim(
      $this->createAssignedTicket('GL-EDIT-2', $conductor),
      $conductor,
    );
    $this->assertSame('claimed', $second->getRunState());
    $this->assertSame(2, $this->liveRunsOnMachine($machine));

    $machine->setMaxParallel(1)->save();
    $conductor = $this->reloadConductor($conductor);
    try {
      $this->claimService()->claim(
        $this->createAssignedTicket('GL-EDIT-3', $conductor),
        $conductor,
      );
      $this->fail(
        'A claim must be refused once the saved budget is below live usage.',
      );
    }
    catch (MachineCapacityException) {
    }
    $this->assertSame(2, $this->liveRunsOnMachine($machine));
  }

}
