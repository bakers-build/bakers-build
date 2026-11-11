<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers bakers_ticket_restart: a parked ticket is released, its runs kept.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketRestartToolTest extends BakersToolTestBase {

  use ForeignWorkspaceTrait;

  /**
   * {@inheritdoc}
   *
   * The runs' error logs are written to the private stream.
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
   * An editor restarts a parked ticket; who and when are stamped.
   */
  public function testRestartReleasesParkedTicket(): void {
    $ticket = $this->ticket('RST-1');
    $runs = $this->seedFailedRuns($ticket, 3);

    $outputs = $this->outputs($this->runTool('bakers_ticket_restart', ['ticket' => $ticket->getIdentifier()]));

    $now = $this->container->get('datetime.time')->getRequestTime();
    self::assertSame($ticket->getIdentifier(), $outputs['ticket']);
    self::assertSame($now, (new \DateTimeImmutable($outputs['restarted_at']))->getTimestamp());
    self::assertSame('actor', $outputs['restarted_by']);
    $stored = $this->reload($ticket);
    self::assertSame($now, $stored->getRestartedAt());
    self::assertSame((int) $this->actor->id(), (int) $stored->getRestartedBy()?->id());
    self::assertFalse($this->container->get('bb_core.failed_run_circuit_breaker')->isTripped($stored));
    $this->assertRunsKept($runs);
  }

  /**
   * A ticket that is not parked is a conflict; nothing is recorded.
   */
  public function testNotParkedIsConflict(): void {
    $ticket = $this->ticket('RST-2');
    $this->seedFailedRuns($ticket, 2);

    $id = $ticket->getIdentifier();
    $result = $this->runTool('bakers_ticket_restart', ['ticket' => $id]);

    $this->assertFailure($result, "Conflict: ticket $id is not parked after repeated failed runs; nothing was restarted.");
    self::assertNull($this->reload($ticket)->getRestartedAt());
  }

  /**
   * A closed ticket is never parked, whatever its runs.
   */
  public function testClosedTicketIsNotParked(): void {
    $ticket = $this->ticket('RST-3');
    $this->seedFailedRuns($ticket, 3);
    $ticket->set('closed', TRUE)->save();

    $this->assertFailure($this->runTool('bakers_ticket_restart', ['ticket' => $ticket->getIdentifier()]), 'is not parked');
    self::assertNull($this->reload($ticket)->getRestartedAt());
  }

  /**
   * A reader who may not update the ticket is refused; nothing changes.
   */
  public function testViewerWithoutUpdateIsRefused(): void {
    $ticket = $this->ticket('RST-4');
    $runs = $this->seedFailedRuns($ticket, 3);
    $etm = $this->container->get('entity_type.manager');
    $etm->getStorage('user_role')->create(['id' => 'viewer', 'label' => 'Viewer'])->save();
    user_role_grant_permissions('viewer', ['view bb_ticket', 'view bb_project']);
    $reader = $this->account('reader', ['viewer']);
    foreach ($etm->getStorage('bb_team')->loadByProperties(['name' => 'tool-team']) as $team) {
      $this->addMembership($team, $reader);
    }
    $this->container->get('current_user')->setAccount($reader);

    $this->assertFailure($this->runTool('bakers_ticket_restart', ['ticket' => $ticket->getIdentifier()]), 'You may not restart ticket ' . $ticket->getIdentifier() . '.');
    self::assertNull($this->reload($ticket)->getRestartedAt());
    $this->assertRunsKept($runs);
  }

  /**
   * A contributor of another workspace cannot even read the ticket.
   */
  public function testOtherWorkspaceIsRefused(): void {
    $ticket = $this->ticket('RST-5');
    $this->seedFailedRuns($ticket, 3);
    $this->foreignWorkspace();

    $this->assertFailure($this->runTool('bakers_ticket_restart', ['ticket' => $ticket->getIdentifier()]), 'does not exist or is not readable');
    self::assertNull($this->reload($ticket)->getRestartedAt());
  }

  /**
   * Clients never write the restart stamp themselves.
   */
  public function testRestartFieldsAreServerDerived(): void {
    $ticket = $this->ticket('RST-6');
    foreach (['restarted_at', 'restarted_by'] as $field) {
      self::assertFalse($ticket->get($field)->access('edit', $this->actor), $field);
    }
  }

  /**
   * Seeds failed runs with an error log, all changed just now.
   *
   * @return list<\Drupal\bb_core\Entity\BbRunInterface>
   *   The runs.
   */
  private function seedFailedRuns(BbTicketInterface $ticket, int $count): array {
    $etm = $this->container->get('entity_type.manager');
    $conductor = $etm->getStorage('bb_conductor')->create([
      'conductor_id' => 'node-' . $ticket->id(),
      'label' => 'node-' . $ticket->id(),
      'owner_user_id' => $this->actor->id(),
      'status' => 'online',
      'project_id' => $this->project->id(),
    ]);
    $conductor->save();
    $runs = [];
    for ($i = 0; $i < $count; $i++) {
      $run = $etm->getStorage('bb_run')->create([
        'ticket_id' => $ticket->id(),
        'conductor_id' => $conductor->id(),
        'state' => 'failed',
      ]);
      assert($run instanceof BbRunInterface);
      $run->setErrorLog('ddev failed ' . $i)->save();
      $runs[] = $run;
    }
    return $runs;
  }

  /**
   * Asserts every run is still stored as failed with its error log.
   *
   * @param list<\Drupal\bb_core\Entity\BbRunInterface> $runs
   *   The seeded runs.
   */
  private function assertRunsKept(array $runs): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_run');
    foreach ($runs as $i => $run) {
      $stored = $storage->loadUnchanged($run->id());
      self::assertInstanceOf(BbRunInterface::class, $stored);
      self::assertSame('failed', $stored->getRunState());
      self::assertStringContainsString('ddev failed ' . $i, (string) $stored->getErrorLog());
    }
  }

}
