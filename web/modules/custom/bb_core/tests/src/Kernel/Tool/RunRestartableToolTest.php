<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers bakers_run_restartable: the runs Restart runs offers, by ticket.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunRestartableToolTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_machine');
  }

  /**
   * A machine and a conductor list their tickets' runs, frozen ones left out.
   */
  public function testMachineAndConductorListRunsByTicket(): void {
    $box = $this->machine($this->actor, 'box-1');
    $here = $this->conductor('box-1-here', $box);
    $there = $this->conductor('box-1-there', $box);
    $first = $this->ticket('RST-1');
    $running = $this->runOn($first, $here, 'running');
    $second = $this->ticket('RST-2');
    $failed = $this->runOn($second, $there, 'failed');
    $frozen = $this->ticket('RST-3');
    $frozen->setFrozen(TRUE);
    $frozen->save();
    $this->runOn($frozen, $here, 'running');
    $this->runOn($this->ticket('RST-4'), $here, 'done');

    $machine = $this->outputs($this->runTool('bakers_run_restartable', ['machine_id' => 'box-1']))['tickets'];
    self::assertSame([
      $this->entry($first, [$running]),
      $this->entry($second, [$failed]),
    ], $machine);
    $conductor = $this->outputs($this->runTool('bakers_run_restartable', ['conductor' => $here->uuid()]))['tickets'];
    self::assertSame([$this->entry($first, [$running])], $conductor);
  }

  /**
   * A ticket lists its newest failed run; a finished ticket lists nothing.
   */
  public function testTicketListsItsRestartableRuns(): void {
    $conductor = $this->conductor('box-1-here', $this->machine($this->actor, 'box-1'));
    $ticket = $this->ticket('RST-5');
    $this->runOn($ticket, $conductor, 'failed');
    $newest = $this->runOn($ticket, $conductor, 'failed');
    $finished = $this->ticket('RST-6');
    $this->runOn($finished, $conductor, 'done');

    self::assertSame([$this->entry($ticket, [$newest])], $this->outputs($this->runTool('bakers_run_restartable', ['ticket' => $ticket->getIdentifier()]))['tickets']);
    self::assertSame([], $this->outputs($this->runTool('bakers_run_restartable', ['ticket' => $finished->getIdentifier()]))['tickets']);
  }

  /**
   * Another owner's machine or conductor lists nothing, like an unknown one.
   */
  public function testForeignTargetsListNothing(): void {
    $box = $this->machine($this->actor, 'box-1');
    $here = $this->conductor('box-1-here', $box);
    $this->runOn($this->ticket('RST-7'), $here, 'running');
    $stranger = $this->account('stranger', ['skill_user']);
    foreach ($this->container->get('entity_type.manager')->getStorage('bb_team')->loadByProperties(['name' => 'tool-team']) as $team) {
      $this->addMembership($team, $stranger);
    }
    $this->container->get('current_user')->setAccount($stranger);

    foreach ([['machine_id' => 'box-1'], ['conductor' => $here->uuid()], ['machine_id' => 'no-such-box'], ['conductor' => 'no-such-conductor']] as $values) {
      self::assertSame([], $this->outputs($this->runTool('bakers_run_restartable', $values))['tickets']);
    }
    foreach ([[], ['machine_id' => 'box-1', 'conductor' => $here->uuid()]] as $values) {
      $this->assertFailure($this->runTool('bakers_run_restartable', $values), 'Give exactly one of machine_id, conductor or ticket.');
    }
  }

  /**
   * The expected entry of a ticket with these runs.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param list<\Drupal\bb_core\Entity\BbRunInterface> $runs
   *   Its runs.
   *
   * @return array<string, mixed>
   *   The entry.
   */
  private function entry(BbTicketInterface $ticket, array $runs): array {
    return [
      'ticket' => $ticket->getIdentifier(),
      'uuid' => (string) $ticket->uuid(),
      'title' => $ticket->getTitle(),
      'runs' => array_map(static fn (BbRunInterface $run): array => [
        'run' => (string) $run->uuid(),
        'number' => (int) $run->id(),
        'state' => $run->getRunState(),
      ], $runs),
    ];
  }

  /**
   * Creates a machine of the owner with this machine_id.
   */
  private function machine(UserInterface $owner, string $host_key): ContentEntityInterface {
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')
      ->create(['name' => $host_key, 'host_key' => $host_key, 'owner_user_id' => $owner->id()]);
    assert($machine instanceof ContentEntityInterface);
    $machine->save();
    return $machine;
  }

  /**
   * Creates a conductor of the actor on the machine.
   */
  private function conductor(string $id, ContentEntityInterface $machine): ContentEntityInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $id,
      'label' => $id,
      'owner_user_id' => $this->actor->id(),
      'status' => 'online',
      'project_id' => $this->project->id(),
      'machine' => $machine->id(),
    ]);
    assert($conductor instanceof ContentEntityInterface);
    $conductor->save();
    return $conductor;
  }

  /**
   * Creates a run of the ticket on the conductor.
   */
  private function runOn(BbTicketInterface $ticket, ContentEntityInterface $conductor, string $state): BbRunInterface {
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $conductor->get('owner_user_id')->target_id,
      'state' => $state,
    ]);
    assert($run instanceof BbRunInterface);
    $run->save();
    return $run;
  }

}
