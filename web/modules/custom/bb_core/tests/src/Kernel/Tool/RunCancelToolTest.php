<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\DependencyInjection\ContainerBuilder;
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
   * The run as stored.
   */
  private function reloadRun(BbRunInterface $run): BbRunInterface {
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadUnchanged($run->id());
    assert($stored instanceof BbRunInterface);
    return $stored;
  }

}
