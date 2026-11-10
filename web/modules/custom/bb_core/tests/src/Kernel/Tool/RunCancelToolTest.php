<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers bakers_run_cancel: a ticket's active runs end as `cancelled`.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class RunCancelToolTest extends BakersToolTestBase {

  /**
   * {@inheritdoc}
   *
   * The run's error log is written to the private stream.
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
    $this->installEntitySchema('file');
    $this->installSchema('file', ['file_usage']);
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
    $this->installEntitySchema('bb_machine');
  }

  /**
   * A ticket editor cancels the active run; the reason lands in its log.
   */
  public function testEditorCancelsActiveRun(): void {
    $ticket = $this->ticket('RUN-1');
    $run = $this->seedRun($ticket, 'running', $this->account('machine-owner'));

    $outputs = $this->outputs($this->runTool('bakers_run_cancel', [
      'ticket' => $ticket->getIdentifier(),
      'reason' => 'wrong branch',
    ]));

    self::assertSame([$run->uuid()], $outputs['runs']);
    self::assertSame([['run' => $run->uuid(), 'ticket' => $ticket->getIdentifier()]], $outputs['cancelled']);
    self::assertSame([], $this->comments($ticket), 'A cancel by ticket posts no comment.');
    $stored = $this->reloadRun($run);
    self::assertSame('cancelled', $stored->getRunState());
    self::assertStringContainsString('cancelled by actor: wrong branch', (string) $stored->getErrorLog());
  }

  /**
   * A reader who may not edit the ticket is refused; the run keeps running.
   */
  public function testReaderIsRefused(): void {
    $ticket = $this->ticket('RUN-2');
    $run = $this->seedRun($ticket, 'running', $this->account('machine-owner'));
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'viewer', 'label' => 'Viewer'])->save();
    user_role_grant_permissions('viewer', ['view bb_ticket', 'view bb_project']);
    $reader = $this->account('reader', ['viewer']);
    foreach ($etm->getStorage('bb_team')->loadByProperties(['name' => 'tool-team']) as $team) {
      $this->addMembership($team, $reader);
    }
    $this->container->get('current_user')->setAccount($reader);

    $this->assertFailure($this->runTool('bakers_run_cancel', ['ticket' => $ticket->getIdentifier(), 'reason' => 'stop']), 'may not cancel run ' . $run->uuid());
    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

  /**
   * A ticket with only terminal runs has nothing to cancel.
   */
  public function testTicketWithoutActiveRunIsRefused(): void {
    $ticket = $this->ticket('RUN-3');
    $run = $this->seedRun($ticket, 'done', $this->account('machine-owner'));

    $this->assertFailure($this->runTool('bakers_run_cancel', ['ticket' => $ticket->getIdentifier(), 'reason' => 'stop']), 'has no active run');
    self::assertSame('done', $this->reloadRun($run)->getRunState());
  }

  /**
   * The agent, acting as its conductor's owner, cancels its own run.
   */
  public function testAgentCancelsItsOwnRun(): void {
    $ticket = $this->ticket('RUN-4');
    $run = $this->seedRun($ticket, 'claimed', $this->actor);

    $this->outputs($this->runTool('bakers_run_cancel', ['ticket' => $ticket->getIdentifier(), 'reason' => 'blocked']));

    self::assertSame('cancelled', $this->reloadRun($run)->getRunState());
  }

  /**
   * Both or neither of ticket and machine_id are refused; no run changes.
   */
  public function testTicketOrMachineExactlyOne(): void {
    $ticket = $this->ticket('RUN-5');
    $run = $this->seedRun($ticket, 'running', $this->actor);

    foreach ([
      ['ticket' => $ticket->getIdentifier(), 'machine_id' => 'box-1', 'reason' => 'stop'],
      ['reason' => 'stop'],
    ] as $values) {
      $this->assertFailure($this->runTool('bakers_run_cancel', $values), 'Give exactly one of ticket or machine_id.');
    }
    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

  /**
   * The owner cancels every active run of one machine, across projects.
   */
  public function testOwnerCancelsByMachine(): void {
    [$box, $second_project] = [$this->machine($this->actor, 'box-1'), $this->secondProject()];
    $here = $this->conductor('box-1-here', $this->actor, $box);
    $there = $this->conductor('box-1-there', $this->actor, $box, $second_project);
    $label = $this->term('label', 'keep-me');
    $first = $this->ticket('MAC-1', ['labels' => [$label->id()], 'conductor_id' => $here->id()]);
    $second = $this->ticket('MAC-2', ['conductor_id' => $here->id()]);
    $third = $this->ticket('MAC-3', ['project_id' => $second_project->id(), 'conductor_id' => $there->id()]);
    $runs = [
      $this->runOn($first, $here, 'running'),
      $this->runOn($second, $here, 'claimed'),
      $this->runOn($third, $there, 'running'),
    ];
    $finished = $this->runOn($first, $here, 'done');
    $states = array_map(fn ($ticket) => $ticket->getState()->getId(), [$first, $second, $third]);

    $outputs = $this->outputs($this->runTool('bakers_run_cancel', ['machine_id' => 'box-1', 'reason' => 'box restarted']));

    $expected = [
      ['run' => $runs[0]->uuid(), 'ticket' => $first->getIdentifier()],
      ['run' => $runs[1]->uuid(), 'ticket' => $second->getIdentifier()],
      ['run' => $runs[2]->uuid(), 'ticket' => $third->getIdentifier()],
    ];
    self::assertEqualsCanonicalizing($expected, $outputs['cancelled']);
    self::assertEqualsCanonicalizing(array_column($expected, 'run'), $outputs['runs']);
    foreach ($runs as $run) {
      $stored = $this->reloadRun($run);
      self::assertSame('cancelled', $stored->getRunState());
      self::assertStringContainsString('cancelled by actor: box restarted', (string) $stored->getErrorLog());
    }
    self::assertSame('done', $this->reloadRun($finished)->getRunState());
    foreach ([$first, $second, $third] as $i => $ticket) {
      $comments = $this->comments($ticket);
      self::assertCount(1, $comments);
      self::assertSame('comment', $comments[0]->get('type')->value);
      self::assertSame((int) $this->actor->id(), (int) $comments[0]->get('author')->target_id);
      self::assertStringContainsString('Run ' . $runs[$i]->uuid() . ' cancelled by actor: box restarted', (string) $comments[0]->get('body')->value);
      $stored = $this->reload($ticket);
      self::assertSame($states[$i], $stored->getState()->getId());
      self::assertFalse($stored->isFrozen());
    }
    self::assertSame([(int) $label->id()], array_map('intval', array_column($this->reload($first)->get('labels')->getValue(), 'target_id')));

    $again = $this->runTool('bakers_run_cancel', ['machine_id' => 'box-1', 'reason' => 'box restarted']);
    self::assertSame([], $this->outputs($again)['runs'], 'A repeat call finds nothing to cancel.');
    self::assertSame('No active run cancelled.', (string) $again->getMessage());

    // A cancel is no failure: each ticket goes back to its own conductor.
    $claims = $this->container->get('bb_core.ticket_claim');
    foreach ([[$first, $here], [$second, $here], [$third, $there]] as [$ticket, $conductor]) {
      self::assertSame('claimed', $claims->claim($this->reload($ticket), $conductor)->getRunState());
    }
  }

  /**
   * A run on the machine whose ticket the owner may not edit is skipped.
   */
  public function testRunWithoutAccessIsSkipped(): void {
    // A conductor account that may edit only the tickets it owns.
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'own_editor', 'label' => 'Own editor'])->save();
    user_role_grant_permissions('own_editor', [
      'view bb_ticket', 'update own bb_ticket', 'view bb_comment', 'create bb_comment',
      'use text format bb_rich', 'view bb_term', 'view bb_project', 'register bakers conductor',
    ]);
    $owner = $this->account('box-owner', ['own_editor']);
    foreach ($etm->getStorage('bb_team')->loadByProperties(['name' => 'tool-team']) as $team) {
      $this->addMembership($team, $owner);
    }
    $here = $this->conductor('box-1-here', $owner, $this->machine($owner, 'box-1'));
    $mine = $this->runOn($this->ticket('MAC-4', ['owner_user_id' => $owner->id()]), $here, 'running');
    $theirs = $this->runOn($this->ticket('MAC-5', ['owner_user_id' => $this->actor->id()]), $here, 'running');
    $this->container->get('current_user')->setAccount($owner);

    $outputs = $this->outputs($this->runTool('bakers_run_cancel', ['machine_id' => 'box-1', 'reason' => 'stop']));

    self::assertSame([$mine->uuid()], $outputs['runs']);
    self::assertSame('cancelled', $this->reloadRun($mine)->getRunState());
    self::assertSame('running', $this->reloadRun($theirs)->getRunState());
  }

  /**
   * A caller who may not comment cancels nothing by machine.
   */
  public function testCallerWithoutCommentAccessIsRefused(): void {
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'no_comment', 'label' => 'No comment'])->save();
    user_role_grant_permissions('no_comment', [
      'view bb_ticket', 'update own bb_ticket', 'view bb_comment',
      'view bb_term', 'view bb_project', 'register bakers conductor',
    ]);
    $owner = $this->account('box-owner', ['no_comment']);
    foreach ($etm->getStorage('bb_team')->loadByProperties(['name' => 'tool-team']) as $team) {
      $this->addMembership($team, $owner);
    }
    $here = $this->conductor('box-1-here', $owner, $this->machine($owner, 'box-1'));
    $ticket = $this->ticket('MAC-7', ['owner_user_id' => $owner->id()]);
    $run = $this->runOn($ticket, $here, 'running');
    $this->container->get('current_user')->setAccount($owner);

    $this->assertFailure($this->runTool('bakers_run_cancel', ['machine_id' => 'box-1', 'reason' => 'stop']), 'You may not comment on tickets.');

    self::assertSame('running', $this->reloadRun($run)->getRunState());
    self::assertSame([], $this->comments($ticket));
  }

  /**
   * Another owner's machine looks exactly like an unknown one.
   */
  public function testForeignMachineRevealsNothing(): void {
    $box = $this->machine($this->actor, 'box-1');
    $run = $this->runOn($this->ticket('MAC-6'), $this->conductor('box-1-here', $this->actor, $box), 'running');
    $unknown = $this->runTool('bakers_run_cancel', ['machine_id' => 'no-such-box', 'reason' => 'stop']);

    $stranger = $this->account('stranger', ['skill_user']);
    foreach ($this->container->get('entity_type.manager')->getStorage('bb_team')->loadByProperties(['name' => 'tool-team']) as $team) {
      $this->addMembership($team, $stranger);
    }
    $this->container->get('current_user')->setAccount($stranger);
    $foreign = $this->runTool('bakers_run_cancel', ['machine_id' => 'box-1', 'reason' => 'stop']);

    self::assertSame($this->outputs($unknown), $this->outputs($foreign));
    self::assertSame((string) $unknown->getMessage(), (string) $foreign->getMessage());
    self::assertSame([], $this->outputs($foreign)['runs']);
    self::assertSame('running', $this->reloadRun($run)->getRunState());
  }

  /**
   * Creates a run of the ticket on a conductor owned by the given account.
   */
  private function seedRun(BbTicketInterface $ticket, string $state, UserInterface $owner): BbRunInterface {
    $etm = $this->container->get('entity_type.manager');
    $conductor = $etm->getStorage('bb_conductor')->create([
      'conductor_id' => 'node-' . $owner->id(),
      'label' => 'node-' . $owner->id(),
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => $this->project->id(),
    ]);
    $conductor->save();
    $run = $etm->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => $state,
    ]);
    assert($run instanceof BbRunInterface);
    $run->save();
    return $run;
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
   * Creates a conductor of the owner on the machine, for a project.
   */
  private function conductor(string $id, UserInterface $owner, ContentEntityInterface $machine, ?ContentEntityInterface $project = NULL): BbConductorInterface {
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'conductor_id' => $id,
      'label' => $id,
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'project_id' => ($project ?? $this->project)->id(),
      'machine' => $machine->id(),
    ]);
    assert($conductor instanceof BbConductorInterface);
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
      // As a claim writes it: the run belongs to its conductor's owner.
      'owner_user_id' => $conductor->get('owner_user_id')->target_id,
      'state' => $state,
    ]);
    assert($run instanceof BbRunInterface);
    $run->save();
    return $run;
  }

  /**
   * A second project of the actor's group and team.
   */
  private function secondProject(): ContentEntityInterface {
    $project = $this->project->createDuplicate();
    $project->set('name', 'tool-project-2');
    $project->save();
    return $project;
  }

  /**
   * The ticket's comments, oldest first.
   *
   * @return list<\Drupal\Core\Entity\ContentEntityInterface>
   *   The comments.
   */
  private function comments(BbTicketInterface $ticket): array {
    /** @var list<\Drupal\Core\Entity\ContentEntityInterface> $comments */
    $comments = array_values($this->container->get('entity_type.manager')->getStorage('bb_comment')->loadByProperties(['ticket_id' => $ticket->id()]));
    return $comments;
  }

  /**
   * The run as stored.
   */
  private function reloadRun(BbRunInterface $run): BbRunInterface {
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadUnchanged($run->id());
    assert($stored instanceof BbRunInterface);
    return $stored;
  }

}
