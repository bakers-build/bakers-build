<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\TypeWorkflows;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the runtime lifecycle BbTicket::preSave() now owns (BB-451).
 *
 * Two independent behaviours, both writes a save performs: `closed` becomes a
 * level-triggered, self-healing projection of terminality (D1), and
 * `cleaned_up_date` is stamped by the server the first time `cleaned_up`
 * becomes TRUE, with an explicit NULL on `cleaned_up` coerced to FALSE (D2 /
 * BB-364 Task 2). One class, one save, one fixture — the boundary is
 * save -> reload -> read the column.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TerminalTicketAutoCloseTest extends KernelTestBase {

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
      'user', 'og_membership', 'bb_group', 'bb_project', 'bb_conductor',
      'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['user']);
  }

  /**
   * Every terminal state of every ticket workflow closes on save (AC 1-3).
   *
   * Iterating TypeWorkflows::terminalTicketStates() rather than naming
   * `done`/`cancelled` so the criterion cannot pass for one workflow and
   * silently fail for another, and covers `cancelled` exactly like `done`
   * without a special case (AC 2).
   */
  public function testEveryTerminalStateOfEveryWorkflowCloses(): void {
    $terminal = TypeWorkflows::terminalTicketStates();
    self::assertNotSame([], $terminal, 'At least one ticket workflow must declare a terminal state.');

    foreach ($terminal as $workflow => $states) {
      foreach ($states as $state) {
        $ticket = $this->createTicket($workflow, $state);
        self::assertTrue(
          $ticket->isClosed(),
          "A $state ticket in $workflow must close on save.",
        );
        self::assertNotNull(
          $ticket->getClosedDate(),
          "A $state ticket in $workflow must carry a closed_date.",
        );
      }
    }
  }

  /**
   * A second save does not move `closed_date` (AC idempotent).
   */
  public function testSecondSaveDoesNotMoveClosedDate(): void {
    $ticket = $this->createTicket('bb_work', 'done');
    $first_date = $ticket->getClosedDate();

    $ticket->set('title', 'renamed')->save();
    $reloaded = $this->reload($ticket);

    self::assertSame($first_date, $reloaded->getClosedDate());
  }

  /**
   * A terminal row whose `closed` was cleared by hand is re-closed (AC 5).
   *
   * This is the level-trigger property the two-arm reap work list (Task 8)
   * depends on: the guard is "state is terminal and closed is falsy", not
   * "state changed to terminal in this save".
   */
  public function testHandClearedClosedIsRepairedOnNextSave(): void {
    $ticket = $this->createTicket('bb_work', 'done');
    self::assertTrue($ticket->isClosed());

    $this->container->get('database')->update('bb_ticket')
      ->fields(['closed' => 0, 'closed_date' => NULL])
      ->condition('id', $ticket->id())
      ->execute();
    $reloaded = $this->reload($ticket);
    self::assertFalse($reloaded->isClosed());

    $reloaded->set('title', 'touch')->save();

    $repaired = $this->reload($ticket);
    self::assertTrue($repaired->isClosed());
    self::assertNotNull($repaired->getClosedDate());
  }

  /**
   * A non-terminal state stores neither `closed` nor `closed_date` (AC).
   */
  public function testNonTerminalStateStoresNeither(): void {
    $ticket = $this->createTicket('bb_work', 'coding');
    self::assertFalse($ticket->isClosed());
    self::assertNull($ticket->getClosedDate());
  }

  /**
   * Closing a ticket in any non-terminal state cancels it and stamps a date.
   *
   * The inverse of closeIfTerminal(): `closed` may only be true of a terminal
   * state, so a write that sets `closed` on a living ticket lands in
   * `cancelled` with `closed_date` set.
   */
  public function testClosingNonTerminalStateCancelsAndDates(): void {
    $manager = $this->container->get('plugin.manager.workflow');
    $seen = 0;
    foreach (TypeWorkflows::ticketWorkflowIds() as $workflow) {
      $definition = $manager->getDefinition($workflow);
      $states = is_array($definition['states'] ?? NULL) ? array_keys($definition['states']) : [];
      foreach ($states as $state) {
        $state = (string) $state;
        if (TypeWorkflows::isTerminal($workflow, $state)) {
          continue;
        }
        $seen++;
        $ticket = $this->createTicket($workflow, $state);
        $ticket->set('closed', TRUE)->save();
        $reloaded = $this->reload($ticket);
        self::assertTrue(
          $reloaded->isClosed(),
          "Closing a $state ticket in $workflow must keep closed.",
        );
        self::assertSame(
          'cancelled',
          (string) $reloaded->get('state')->value,
          "Closing a $state ticket in $workflow must cancel it.",
        );
        self::assertNotNull(
          $reloaded->getClosedDate(),
          "Closing a $state ticket in $workflow must stamp closed_date.",
        );
      }
    }
    self::assertGreaterThan(0, $seen, 'Every ticket workflow must have a non-terminal state.');
  }

  /**
   * A closed terminal ticket whose date was cleared is dated on the next save.
   */
  public function testClosedTerminalWithNullDateIsStampedOnSave(): void {
    $ticket = $this->createTicket('bb_work', 'done');
    self::assertTrue($ticket->isClosed());

    $this->container->get('database')->update('bb_ticket')
      ->fields(['closed_date' => NULL])
      ->condition('id', $ticket->id())
      ->execute();
    $reloaded = $this->reload($ticket);
    self::assertNull($reloaded->getClosedDate());

    $reloaded->set('title', 'touch')->save();
    $stamped = $this->reload($ticket);
    self::assertTrue($stamped->isClosed());
    $first_date = $stamped->getClosedDate();
    self::assertNotNull($first_date);

    $stamped->set('title', 'touch-again')->save();
    self::assertSame($first_date, $this->reload($ticket)->getClosedDate());
  }

  /**
   * A ticket leaving a terminal state by a raw write stays closed and terminal.
   *
   * The workflows define no transition out of a terminal state, so this is
   * unreachable through normal transitions; a raw `--state` write is the only
   * way to exercise it. `closed` only ever sets, and the closed-implies-
   * terminal invariant cancels the non-terminal landing state.
   */
  public function testLeavingTerminalStateByRawWriteKeepsClosed(): void {
    $ticket = $this->createTicket('bb_work', 'done');
    self::assertTrue($ticket->isClosed());

    $ticket->set('state', 'working')->save();

    $reloaded = $this->reload($ticket);
    self::assertSame('cancelled', (string) $reloaded->get('state')->value);
    self::assertTrue($reloaded->isClosed(), 'closed must never be cleared by a state change.');
  }

  /**
   * Flipping `cleaned_up` stamps a date; a second save leaves it alone.
   */
  public function testFlippingCleanedUpStampsDateOnce(): void {
    $ticket = $this->createTicket('bb_work', 'coding');
    self::assertNull($ticket->getCleanedUpDate());

    $ticket->markCleanedUp()->save();
    $reloaded = $this->reload($ticket);
    $first_date = $reloaded->getCleanedUpDate();
    self::assertNotNull($first_date);

    $reloaded->set('title', 'touch')->save();
    $second = $this->reload($ticket);
    self::assertSame($first_date, $second->getCleanedUpDate());
  }

  /**
   * A ticket closed but not cleaned up has `cleaned_up_date` NULL.
   *
   * The two lifecycles are independent: closing sets nothing on the cleanup
   * side.
   */
  public function testClosedTicketWithoutCleanupHasNullCleanedUpDate(): void {
    $ticket = $this->createTicket('bb_work', 'done');
    self::assertTrue($ticket->isClosed());
    self::assertNull($ticket->getCleanedUpDate());
  }

  /**
   * A cleanup that runs after a close leaves `closed`/`closed_date` untouched.
   */
  public function testCleanupAfterCloseLeavesClosedFieldsByteIdentical(): void {
    $ticket = $this->createTicket('bb_work', 'done');
    $closed_date = $ticket->getClosedDate();

    $ticket->markCleanedUp()->save();
    $reloaded = $this->reload($ticket);

    self::assertTrue($reloaded->isClosed());
    self::assertSame($closed_date, $reloaded->getClosedDate());
    self::assertTrue($reloaded->isCleanedUp());
  }

  /**
   * An explicit NULL on `cleaned_up` stores 0 on create, read as a raw column.
   *
   * The isCleanedUp() getter casts to bool and would hide the NULL/0
   * difference this turns on, so the assertion reads the column directly.
   */
  public function testExplicitNullCleanedUpStoresZeroOnCreate(): void {
    $ticket = $this->createTicket('bb_work', 'coding');
    self::assertSame(0, $this->readCleanedUpColumn($ticket));
  }

  /**
   * An explicit NULL on `cleaned_up` stores 0 on update too.
   */
  public function testExplicitNullCleanedUpStoresZeroOnUpdate(): void {
    $ticket = $this->createTicket('bb_work', 'coding');
    $ticket->markCleanedUp()->save();
    self::assertSame(1, $this->readCleanedUpColumn($ticket));

    $ticket->set('cleaned_up', NULL)->save();

    self::assertSame(0, $this->readCleanedUpColumn($ticket));
  }

  /**
   * A written TRUE survives the NULL-coercion branch.
   */
  public function testWrittenTrueSurvivesCoercion(): void {
    $ticket = $this->createTicket('bb_work', 'coding');
    $ticket->markCleanedUp()->save();

    $reloaded = $this->reload($ticket);
    self::assertTrue($reloaded->isCleanedUp());
    self::assertSame(1, $this->readCleanedUpColumn($reloaded));
  }

  /**
   * Creates and saves one ticket in the given workflow and state.
   *
   * The initial `create()` array carries no `state`: state_machine sets the
   * workflow's own initial state, and this method transitions from there via
   * a raw `set('state', ...)` write so a fixture can land in any state,
   * terminal or not, the same way a `--state` write over an undefined edge
   * does.
   */
  private function createTicket(string $workflow, string $state): BbTicketInterface {
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'workflow' => $workflow,
        'title' => 'auto-close-' . mt_rand(),
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    $ticket->set('state', $state)->save();
    return $ticket;
  }

  /**
   * Reloads a ticket from storage, bypassing every cache layer.
   */
  private function reload(BbTicketInterface $ticket): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([(int) $ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Reads the raw `cleaned_up` column, so NULL and 0 stay distinguishable.
   */
  private function readCleanedUpColumn(BbTicketInterface $ticket): ?int {
    $value = $this->container->get('database')->select('bb_ticket', 't')
      ->fields('t', ['cleaned_up'])
      ->condition('id', $ticket->id())
      ->execute()
      ->fetchField();
    return ($value === NULL || $value === FALSE) ? NULL : (int) $value;
  }

}
