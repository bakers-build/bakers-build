<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Restart runs on a machine or a conductor: the covered set and its cancel.
 *
 * Covered are a target's claimed or running runs plus, per open ticket that
 * is not frozen, a newest run that failed on it. Each is cancelled with a
 * note; the ticket keeps state and labels, and the claim logic gives it a
 * fresh run.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RestartRunsTest extends ClaimKernelTestBase {

  /**
   * The base conductor's machine.
   */
  private BbMachineInterface $machine;

  /**
   * The owner of the machine and its conductors.
   */
  private UserInterface $owner;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_machine');
    $owner = $this->conductor->get('owner_user_id')->entity;
    assert($owner instanceof UserInterface);
    $this->owner = $owner;
    $this->machine = $this->createMachine('workstation');
    $this->conductor->set('machine', $this->machine->id())->save();
  }

  /**
   * A conductor covers its active runs and the newest failed run per ticket.
   */
  public function testConductorCoversActiveAndNewestFailedRuns(): void {
    $running = $this->seedRun($this->seedAssignedTicket('working'), 'working', 'running');
    $claimed = $this->seedRun($this->seedAssignedTicket('plan'), 'plan', 'claimed');
    $failed = $this->seedRun($this->seedAssignedTicket('plan'), 'plan', 'failed');
    $recovered = $this->seedAssignedTicket('plan');
    $this->seedRun($recovered, 'plan', 'failed');
    $this->seedRun($recovered, 'plan', 'done');
    $closed = $this->seedAssignedTicket('plan');
    $this->seedRun($closed, 'plan', 'failed');
    $closed->getState()->applyTransitionById('cancel');
    $closed->save();
    $sibling = $this->createConductor($this->owner, 'node-sibling');
    $sibling->set('machine', $this->machine->id())->save();
    $sibling_run = $this->seedRunOn($sibling, $this->seedAssignedTicket('working'), 'running');
    $other_machine = $this->createConductor($this->owner, 'node-elsewhere');
    $other_machine->set('machine', $this->createMachine('laptop')->id())->save();
    $this->seedRunOn($other_machine, $this->seedAssignedTicket('working'), 'running');
    foreach (['running', 'failed'] as $state) {
      $frozen = $this->seedAssignedTicket('working');
      $frozen->setFrozen(TRUE);
      $frozen->save();
      $this->seedRun($frozen, 'working', $state);
    }

    self::assertSame(
      $this->ids([$running, $claimed, $failed]),
      $this->ids(TicketInterventions::restartCoveredRuns($this->conductor)),
    );
    self::assertSame(
      $this->ids([$running, $claimed, $failed, $sibling_run]),
      $this->ids(TicketInterventions::restartCoveredRuns($this->machine)),
    );
  }

  /**
   * A ticket's own set: its active runs and a newest run that failed.
   *
   * The failed run need not park the ticket; a frozen or closed ticket and a
   * ticket whose newest run succeeded have none.
   */
  public function testTicketCoversActiveRunsAndNewestFailedRun(): void {
    $failed = $this->seedAssignedTicket('plan');
    $failed_run = $this->seedRun($failed, 'plan', 'failed');
    $running = $this->seedAssignedTicket('working');
    $running_run = $this->seedRun($running, 'working', 'running');
    $recovered = $this->seedAssignedTicket('plan');
    $this->seedRun($recovered, 'plan', 'failed');
    $this->seedRun($recovered, 'plan', 'done');
    $frozen = $this->seedAssignedTicket('working');
    $this->seedRun($frozen, 'working', 'failed');
    $frozen->setFrozen(TRUE);
    $frozen->save();

    self::assertFalse($this->container->get('bb_core.failed_run_circuit_breaker')->isTripped($failed));
    self::assertSame($this->ids([$failed_run]), $this->ids(TicketInterventions::ticketRestartRuns($failed)));
    self::assertSame($this->ids([$running_run]), $this->ids(TicketInterventions::ticketRestartRuns($running)));
    self::assertSame([], TicketInterventions::ticketRestartRuns($recovered));
    self::assertSame([], TicketInterventions::ticketRestartRuns($frozen));
    self::assertSame(
      [(int) $failed->id() => [(int) $failed_run->id()], (int) $running->id() => [(int) $running_run->id()]],
      array_map(fn (array $runs): array => $this->ids($runs), TicketInterventions::byTicket([$failed_run, $running_run])),
    );
  }

  /**
   * The owner cancels the selected runs with a note; the ticket stays.
   */
  public function testOwnerCancelsSelectedRunsWithNoteAndKeepsTicket(): void {
    $active_ticket = $this->seedAssignedTicket('working');
    $active = $this->seedRun($active_ticket, 'working', 'running');
    $parked = $this->seedAssignedTicket('plan');
    $this->seedRun($parked, 'plan', 'failed');
    $this->seedRun($parked, 'plan', 'failed');
    $last_failed = $this->seedRun($parked, 'plan', 'failed');
    $left_out = $this->seedRun($this->seedAssignedTicket('plan'), 'plan', 'claimed');
    $breaker = $this->container->get('bb_core.failed_run_circuit_breaker');
    self::assertTrue($breaker->isTripped($parked));

    $restarted = TicketInterventions::cancelSelectedRuns([$active, $last_failed], $this->owner, TicketInterventions::restartReason($this->machine));

    self::assertSame($this->ids([$active, $last_failed]), $this->ids($restarted));
    foreach ([$active, $last_failed] as $run) {
      $reloaded = $this->reloadRun($run);
      self::assertSame('cancelled', $reloaded->getRunState());
      self::assertStringContainsString('cancelled by claim-base-owner: Restart runs (machine workstation)', (string) $reloaded->getErrorLog());
    }
    self::assertSame('claimed', $this->reloadRun($left_out)->getRunState());
    self::assertSame('working', $this->reloadTicket($active_ticket)->getState()->getId());
    self::assertFalse($breaker->isTripped($this->reloadTicket($parked)));
    self::assertSame('Restart runs (conductor node-base)', TicketInterventions::restartReason($this->conductor));
    self::assertSame('Restart runs (ticket ' . $parked->getIdentifier() . ')', TicketInterventions::restartReason($parked));
  }

  /**
   * One run outside every rule refuses the whole selection.
   */
  public function testOneRefusedRunCancelsNothing(): void {
    $active = $this->seedRun($this->seedAssignedTicket('working'), 'working', 'running');
    $done = $this->seedRun($this->seedAssignedTicket('working'), 'working', 'done');

    try {
      TicketInterventions::cancelSelectedRuns([$active, $done], $this->owner, 'stop');
      self::fail('A finished run must refuse the selection.');
    }
    catch (\InvalidArgumentException $e) {
      self::assertStringContainsString((string) $done->uuid(), $e->getMessage());
    }
    self::assertSame('running', $this->reloadRun($active)->getRunState());
  }

  /**
   * The reported condition: two dead running runs block their tickets.
   *
   * One machine-level restart leaves no active run, and the conductor claims
   * each ticket exactly once.
   */
  public function testMachineRestartFreesTicketsForOneFreshClaimEach(): void {
    $first = $this->seedAssignedTicket('working');
    $second = $this->seedAssignedTicket('plan');
    $this->seedRun($first, 'working', 'running');
    $this->seedRun($second, 'plan', 'running');
    self::assertNull($this->claimService->claimNext($this->conductor));

    TicketInterventions::cancelSelectedRuns(TicketInterventions::restartCoveredRuns($this->machine), $this->owner, 'restart');

    $etm = $this->container->get('entity_type.manager');
    self::assertSame([], TicketInterventions::activeMachineRuns($this->machine, $etm));
    $claimed = [];
    while ($run = $this->claimService->claimNext($this->conductor)) {
      $claimed[] = $run->getTicketId();
    }
    sort($claimed);
    self::assertSame([(int) $first->id(), (int) $second->id()], $claimed);
  }

  /**
   * Creates a machine owned by the conductors' owner.
   */
  private function createMachine(string $name): BbMachineInterface {
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')->create([
      'name' => $name,
      'host_key' => $name,
      'owner_user_id' => $this->owner->id(),
      'max_parallel' => 5,
      'current_load' => 0,
    ]);
    assert($machine instanceof BbMachineInterface);
    $machine->save();
    return $machine;
  }

  /**
   * Seeds a run of the ticket on another conductor.
   */
  private function seedRunOn(BbConductorInterface $conductor, BbTicketInterface $ticket, string $state): BbRunInterface {
    $run = $this->seedRun($ticket, $ticket->getState()->getId(), $state);
    $run->set('conductor_id', $conductor->id())->save();
    return $run;
  }

  /**
   * The sorted ids of these runs.
   *
   * @param array<\Drupal\bb_core\Entity\BbRunInterface> $runs
   *   The runs.
   *
   * @return list<int>
   *   Their ids.
   */
  private function ids(array $runs): array {
    $ids = array_map(static fn (BbRunInterface $run): int => (int) $run->id(), array_values($runs));
    sort($ids);
    return $ids;
  }

}
