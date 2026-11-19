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
 * Covers bakers_run_list restartable: the runs Restart runs offers.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunListRestartableToolTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_machine');
    user_role_grant_permissions('skill_user', ['view bb_run']);
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

    $machine = $this->outputs($this->runTool('bakers_run_list', ['machine_id' => 'box-1', 'restartable' => TRUE]));
    self::assertSame([...$this->entry($first, [$running]), ...$this->entry($second, [$failed])], $this->brief($machine['runs']));
    self::assertNull($machine['next_offset']);
    $conductor = $this->outputs($this->runTool('bakers_run_list', ['conductor' => $here->uuid(), 'restartable' => TRUE]))['runs'];
    self::assertSame($this->entry($first, [$running]), $this->brief($conductor));
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

    self::assertSame($this->entry($ticket, [$newest]), $this->brief($this->restartable($ticket)));
    self::assertSame([], $this->restartable($finished));
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

    $targets = [
      ['machine_id' => 'box-1'],
      ['conductor' => $here->uuid()],
      ['machine_id' => 'no-such-box'],
      ['conductor' => 'no-such-conductor'],
    ];
    foreach ($targets as $values) {
      self::assertSame([], $this->outputs($this->runTool('bakers_run_list', $values + ['restartable' => TRUE]))['runs']);
    }
    foreach ([[], ['machine_id' => 'box-1', 'conductor' => $here->uuid()]] as $values) {
      $this->assertFailure($this->runTool('bakers_run_list', $values + ['restartable' => TRUE]), 'Give exactly one of ticket, machine_id or conductor.');
    }
    $this->assertFailure($this->runTool('bakers_run_list', ['machine_id' => 'box-1']), 'machine_id and conductor list restartable runs only; set restartable.');
  }

  /**
   * The expected rows of a ticket with these runs, as brief() reduces them.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param list<\Drupal\bb_core\Entity\BbRunInterface> $runs
   *   Its runs.
   *
   * @return list<array<string, mixed>>
   *   The rows.
   */
  private function entry(BbTicketInterface $ticket, array $runs): array {
    return array_map(static fn (BbRunInterface $run): array => [
      'uuid' => (string) $run->uuid(),
      'state' => $run->getRunState(),
      'number' => (int) $run->id(),
      'ticket' => $ticket->getIdentifier(),
      'ticket_title' => $ticket->getTitle(),
    ], $runs);
  }

  /**
   * The rows reduced to the fields Restart runs shows.
   *
   * @param list<array<string, mixed>> $rows
   *   The tool's runs.
   *
   * @return list<array<string, mixed>>
   *   The reduced rows.
   */
  private function brief(array $rows): array {
    $keys = array_flip(['uuid', 'number', 'state', 'ticket', 'ticket_title']);
    return array_map(static fn (array $row): array => array_intersect_key($row, $keys), $rows);
  }

  /**
   * The ticket's restartable runs as the tool lists them.
   *
   * @return list<array<string, mixed>>
   *   The tool's runs.
   */
  private function restartable(BbTicketInterface $ticket): array {
    return $this->outputs($this->runTool('bakers_run_list', [
      'ticket' => $ticket->getIdentifier(),
      'restartable' => TRUE,
    ]))['runs'];
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
