<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Database\Database;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Run\RunSummary;
use Drupal\bb_core\Run\TicketRunSummary;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A ticket's runs summed up: how many, and the newest run's state and time.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketRunSummaryTest extends KernelTestBase {

  use UserCreationTrait;
  use WorkspaceFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'field', 'file', 'image', 'og', 'bb_core', 'state_machine',
    'entity', 'user', 'options', 'text', 'link', 'filter',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'bb_workspace', 'bb_group', 'bb_project', 'bb_ticket', 'bb_run',
      'bb_conductor', 'file', 'user', 'og_membership',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['filter']);
    $this->config('system.date')->set('timezone.default', 'UTC')->save();
    // Each fixture ticket sits in its own workspace; `administer bakers`
    // reads across them without a membership in each.
    $this->setUpCurrentUser(['name' => 'run-reader'], ['administer bakers']);
  }

  /**
   * Two runs count two; the newer one names the state and the time.
   */
  public function testCountsRunsAndPicksTheNewest(): void {
    $now = $this->now();
    $ticket = $this->ticketWithRun('done', $now - 7200);
    $this->addRun($ticket, 'failed', $now - 3600);

    $summary = $this->summaryOf($ticket);
    self::assertSame(2, $summary->count);
    self::assertSame('failed', $summary->latestState);
    self::assertSame($now - 3600, $summary->latestAt);
    self::assertSame('2 runs · last failed 1 hour ago', $summary->text());
    self::assertSame('critical', $summary->tone());
  }

  /**
   * The newest run is the Run history's top row: created, then id, descending.
   *
   * Ids and creation times can disagree (an imported run, a backdated
   * fixture), so the highest id is not always the newest run.
   */
  public function testTheNewestIsTheRunHistorysTopRow(): void {
    $now = $this->now();
    $ticket = $this->ticketWithRun('failed', $now - 60);
    $this->addRun($ticket, 'done', $now - 3600);
    self::assertSame('failed', $this->summaryOf($ticket)->latestState, 'The later created run wins over a higher id.');

    $tied = $this->ticketWithRun('failed', $now - 600);
    $this->addRun($tied, 'claimed', $now - 600);
    self::assertSame('claimed', $this->summaryOf($tied)->latestState, 'On the same second the higher id wins.');
    self::assertSame('attention', $this->summaryOf($tied)->tone());
  }

  /**
   * One run reads singular; a ticket without runs reads "No runs yet".
   */
  public function testSingularAndEmpty(): void {
    $ticket = $this->ticketWithRun('done', $this->now() - 120);
    self::assertSame('1 run · last done 2 minutes ago', $this->summaryOf($ticket)->text());
    self::assertSame('idle', $this->summaryOf($ticket)->tone());

    $empty = $this->ticketWithRun('done', $this->now());
    $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->delete($empty->get('runs')->referencedEntities());
    $summary = $this->summaryOf($empty);
    self::assertSame(0, $summary->count);
    self::assertNull($summary->latestState);
    self::assertSame('No runs yet', $summary->text());
    self::assertNull($summary->tone());
  }

  /**
   * A reader counts only the runs they may view.
   *
   * "No runs yet" is true only for a reader who may view every run, so any
   * other reader with no visible run gets no ticket summary at all.
   */
  public function testCountsOnlyRunsTheReaderMayView(): void {
    $ticket = $this->ticketWithRun('failed', $this->now());
    $empty = $this->ticketWithRun('done', $this->now());
    $this->container->get('entity_type.manager')->getStorage('bb_run')
      ->delete($empty->get('runs')->referencedEntities());
    self::assertSame('No runs yet', $this->service()->forTicket($empty->id())?->text(), 'A run administrator is told there are none.');

    $this->setUpCurrentUser(['name' => 'no-runs']);
    self::assertSame(0, $this->summaryOf($ticket)->count);
    self::assertNull($this->service()->forTicket($ticket->id()), 'Runs this reader cannot see are not "No runs yet".');
    self::assertNull($this->service()->forTicket($empty->id()));
  }

  /**
   * One ticket is summed up once per request, per reader.
   */
  public function testOneTicketIsSummedUpOncePerRequestAndReader(): void {
    $ticket = $this->ticketWithRun('failed', $this->now());

    Database::startLog('run-summary-ticket');
    $first = $this->service()->forTicket($ticket->id());
    $second = $this->service()->forTicket($ticket->id());
    $queries = array_filter(
      Database::getLog('run-summary-ticket'),
      static fn(array $query): bool => str_contains((string) $query['query'], 'bb_run'),
    );
    self::assertCount(1, $queries);
    self::assertSame($first, $second);

    $this->setUpCurrentUser(['name' => 'no-runs']);
    self::assertNull($this->service()->forTicket($ticket->id()), 'Another reader is not served the first reader\'s summary.');
  }

  /**
   * A page of ten tickets costs one query on the runs.
   */
  public function testOneQueryForTheWholePage(): void {
    $ids = [];
    foreach (range(1, 10) as $i) {
      $ticket = $this->ticketWithRun('done', $this->now() - $i * 60);
      $this->addRun($ticket, 'failed', $this->now() - $i);
      $ids[] = (int) $ticket->id();
    }

    Database::startLog('run-summary');
    $summaries = $this->service()->forTickets($ids);
    $queries = array_filter(
      Database::getLog('run-summary'),
      static fn(array $query): bool => str_contains((string) $query['query'], 'bb_run'),
    );

    self::assertCount(1, $queries);
    self::assertSame($ids, array_keys($summaries));
    foreach ($summaries as $summary) {
      self::assertSame(2, $summary->count);
      self::assertSame('failed', $summary->latestState);
    }
  }

  /**
   * The request time every fixture is measured against.
   */
  private function now(): int {
    return $this->container->get('datetime.time')->getRequestTime();
  }

  /**
   * A ticket in its own workspace with one run in the given state.
   */
  private function ticketWithRun(string $state, int $created): BbTicketInterface {
    $run = $this->createRunInWorkspace();
    $run->set('state', $state)->set('created', $created)->save();
    $ticket = $run->get('ticket_id')->entity;
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Adds a run to the ticket.
   */
  private function addRun(BbTicketInterface $ticket, string $state, int $created): void {
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => $state,
      'created' => $created,
    ])->save();
  }

  /**
   * The ticket's summary, as the service computes it.
   */
  private function summaryOf(BbTicketInterface $ticket): RunSummary {
    return $this->service()->forTickets([(int) $ticket->id()])[(int) $ticket->id()];
  }

  /**
   * The service under test.
   */
  private function service(): TicketRunSummary {
    return $this->container->get('bb_core.ticket_run_summary');
  }

}
