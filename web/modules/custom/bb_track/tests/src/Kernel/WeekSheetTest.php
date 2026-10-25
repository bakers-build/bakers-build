<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\WeekSheet;
use Drupal\bb_track\WeekSheetCell;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The personal week grid is saved all or nothing, never twice.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WeekSheetTest extends WorkTimeTestBase {

  /**
   * Ticket on the fixture project.
   */
  private BbTicketInterface $ticket;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'Grid ticket',
      'project_id' => $this->project->id(),
      'workflow' => 'bb_work',
    ]);
    $ticket->save();
    assert($ticket instanceof BbTicketInterface);
    $this->ticket = $ticket;
  }

  /**
   * One save creates, updates, deletes and books proposed cells.
   */
  public function testSaveCreatesUpdatesDeletesAndBooksProposals(): void {
    $kept = $this->recorded('2026-08-03', 3600);
    $cleared = $this->recorded('2026-08-04', 1800, (int) $this->ticket->id());
    $proposed = $this->proposedRow('2026-08-05', 7200);
    $result = $this->sheet()->save([
      $this->cell($kept, '1:30'),
      $this->cell($cleared, ''),
      $this->cell($proposed, '2:00'),
      new WeekSheetCell('2026-08-06', (int) $this->project->id(), NULL, '0:45', NULL, NULL),
    ]);
    self::assertSame([], $result['errors']);
    self::assertSame(
      ['changed' => 4, 'recorded' => 1],
      ['changed' => $result['changed'], 'recorded' => $result['recorded']],
    );
    self::assertEquals(5400, $this->reload($kept)->get('duration_seconds')->value);
    self::assertNull($this->reload($cleared));
    self::assertSame('recorded', $this->reload($proposed)->get('state')->value);
    self::assertSame('draft', Submission::load($proposed->get('submission_id')->target_id)->get('state')->value);
    $new = $this->rowsOn('2026-08-06')[0];
    self::assertSame('Work', $new->get('description')->value);
    self::assertEquals(2700, $new->get('duration_seconds')->value);
    self::assertSame('recorded', $new->get('state')->value);
    self::assertEquals($this->accountId, $new->get('account_id')->target_id);
  }

  /**
   * A new cell on a ticket takes the ticket title as its description.
   */
  public function testNewTicketCellUsesTheTicketTitle(): void {
    $result = $this->sheet()->save([new WeekSheetCell('2026-08-06', (int) $this->project->id(), (int) $this->ticket->id(), '1:00', NULL, NULL)]);
    self::assertSame([], $result['errors']);
    self::assertSame('Grid ticket', $this->rowsOn('2026-08-06')[0]->get('description')->value);
  }

  /**
   * Any invalid cell writes nothing and reports every invalid cell.
   */
  public function testInvalidCellsWriteNothing(): void {
    $kept = $this->recorded('2026-08-03', 3600);
    $proposed = $this->proposedRow('2026-08-05', 7200);
    $cells = [
      $this->cell($kept, '2:00'),
      new WeekSheetCell('2026-08-04', (int) $this->project->id(), NULL, 'abc', NULL, NULL),
      new WeekSheetCell('2026-08-06', (int) $this->project->id(), NULL, '0:00', NULL, NULL),
      $this->cell($proposed, '25:61'),
    ];
    $result = $this->sheet()->save($cells);
    self::assertCount(3, $result['errors']);
    self::assertArrayHasKey($cells[1]->key(), $result['errors']);
    self::assertSame('Duration must be between 0:01 and 24:00.', $result['errors'][$cells[2]->key()]);
    self::assertSame(0, $result['changed']);
    self::assertEquals(3600, $this->reload($kept)->get('duration_seconds')->value);
    self::assertSame('proposed', $this->reload($proposed)->get('state')->value);
    self::assertCount(2, $this->ownRows());
  }

  /**
   * A replayed save of a new cell stores it once.
   */
  public function testRepeatedSaveIsNoop(): void {
    $cells = [new WeekSheetCell('2026-08-06', (int) $this->project->id(), NULL, '0:45', NULL, NULL)];
    $this->sheet()->save($cells);
    $second = $this->sheet()->save($cells);
    self::assertSame([], $second['errors']);
    self::assertSame(0, $second['changed']);
    self::assertCount(1, $this->ownRows());
  }

  /**
   * A cell that gained a second entry after rendering is not overwritten.
   */
  public function testCellGainedSecondEntry(): void {
    $first = $this->recorded('2026-08-03', 3600);
    $cell = $this->cell($first, '2:00');
    $this->recorded('2026-08-03', 600);
    $result = $this->sheet()->save([$cell]);
    self::assertArrayHasKey($cell->key(), $result['errors']);
    self::assertEquals(3600, $this->reload($first)->get('duration_seconds')->value);
  }

  /**
   * A cell edited elsewhere after rendering reports a stale write.
   */
  public function testStaleCellIsReported(): void {
    $row = $this->recorded('2026-08-03', 3600);
    $cell = $this->cell($row, '2:00');
    $this->reload($row)->set('duration_seconds', 4200)->save();
    self::assertSame('This entry changed. Reload the week.', $this->sheet()->save([$cell])['errors'][$cell->key()]);
    self::assertEquals(4200, $this->reload($row)->get('duration_seconds')->value);
  }

  /**
   * Another employee's entry cannot be changed through a forged cell.
   */
  public function testForeignCellIsRejected(): void {
    $foreign = $this->recordedAs($this->peer, '2026-08-03', 3600);
    $result = $this->sheet()->save([$this->cell($foreign, '0:10')]);
    self::assertNotSame([], $result['errors']);
    self::assertEquals(3600, $this->reload($foreign)->get('duration_seconds')->value);
  }

  /**
   * A project the viewer sees but may not record on gets no new cell.
   */
  public function testForbiddenProjectCellIsRejected(): void {
    // Member of the fixture workspace without a recording role.
    $viewer = $this->createUser(['view bb_project', 'view bb_ticket', 'view bb_group'], 'viewer');
    self::assertInstanceOf(UserInterface::class, $viewer);
    $workspace = $this->project->getGroup()?->get('workspace_id')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $workspace);
    $this->addMembership($workspace, $viewer);
    $this->container->get('current_user')->setAccount($viewer);
    self::assertTrue($this->project->access('view', $viewer));
    $result = $this->sheet()->save([new WeekSheetCell('2026-08-06', (int) $this->project->id(), NULL, '1:00', NULL, NULL)]);
    self::assertSame(['2026-08-06:' . $this->project->id() . ':0' => 'Project is unavailable for recording.'], $result['errors']);
    self::assertSame([], $this->container->get('entity_type.manager')->getStorage('bb_track_worklog')->loadByProperties(['owner_user_id' => $viewer->id()]));
  }

  /**
   * The grid groups the owner's week rows by cell.
   */
  public function testCellsGroupTheOwnersWeek(): void {
    $a = $this->recorded('2026-08-03', 3600);
    $b = $this->recorded('2026-08-03', 600);
    $proposed = $this->proposedRow('2026-08-05', 7200);
    $this->recorded('2026-08-10', 600);
    $this->recordedAs($this->peer, '2026-08-04', 600);
    $cells = $this->sheet()->cells((int) $this->employee->id(), '2026-08-03', NULL);
    $project = (int) $this->project->id();
    self::assertSame(["2026-08-03:$project:0", "2026-08-05:$project:0"], array_keys($cells));
    self::assertEqualsCanonicalizing([(int) $a->id(), (int) $b->id()], array_map(fn (Worklog $row): int => (int) $row->id(), $cells["2026-08-03:$project:0"]));
    $only = $this->sheet()->cells((int) $this->employee->id(), '2026-08-03', (int) $proposed->get('submission_id')->target_id);
    self::assertSame(["2026-08-05:$project:0"], array_keys($only));
  }

  /**
   * A proposed entry sharing a cell with a manual entry is locked, yet booked.
   */
  public function testLockedProposalCellIsBookedOnSave(): void {
    $manual = $this->recorded('2026-08-05', 600);
    $proposed = $this->proposedRow('2026-08-05', 7200);
    $submission = (int) $proposed->get('submission_id')->target_id;
    $project = (int) $this->project->id();
    $cells = $this->sheet()->cells((int) $this->employee->id(), '2026-08-03', $submission);
    self::assertEqualsCanonicalizing(
      [(int) $manual->id(), (int) $proposed->id()],
      array_map(fn (Worklog $row): int => (int) $row->id(), $cells["2026-08-05:$project:0"]),
    );
    $result = $this->sheet()->save([], array_keys($cells), $submission);
    self::assertSame([], $result['errors']);
    self::assertSame(1, $result['recorded']);
    self::assertSame('recorded', $this->reload($proposed)->get('state')->value);
    self::assertSame('draft', Submission::load($submission)->get('state')->value);
    self::assertEquals(600, $this->reload($manual)->get('duration_seconds')->value);
  }

  /**
   * A cell added while reviewing a proposal joins it and is booked with it.
   */
  public function testCellAddedToProposalJoinsIt(): void {
    $proposed = $this->proposedRow('2026-08-05', 7200);
    $submission = (int) $proposed->get('submission_id')->target_id;
    $result = $this->sheet()->save([
      $this->cell($proposed, '2:00'),
      new WeekSheetCell('2026-08-06', (int) $this->project->id(), NULL, '0:45', NULL, NULL),
    ], [], $submission);
    self::assertSame([], $result['errors']);
    $new = $this->rowsOn('2026-08-06')[0];
    self::assertEquals($submission, $new->get('submission_id')->target_id);
    self::assertSame('recorded', $new->get('state')->value);
    self::assertSame('draft', Submission::load($submission)->get('state')->value);
  }

  /**
   * Replaying a save of changed and proposed cells changes nothing more.
   */
  public function testReplayedUpdateIsNoop(): void {
    $kept = $this->recorded('2026-08-03', 3600);
    $proposed = $this->proposedRow('2026-08-05', 7200);
    $cells = [$this->cell($kept, '2:00'), $this->cell($proposed, '2:00')];
    self::assertSame([], $this->sheet()->save($cells)['errors']);
    $replay = $this->sheet()->save($cells);
    self::assertSame([], $replay['errors']);
    self::assertSame(0, $replay['changed']);
    self::assertEquals(7200, $this->reload($kept)->get('duration_seconds')->value);
  }

  /**
   * A stale cell whose stored value differs still refuses the save.
   */
  public function testStaleCellWithOtherValueStillRefuses(): void {
    $row = $this->recorded('2026-08-03', 3600);
    $cell = $this->cell($row, '2:00');
    $this->reload($row)->set('duration_seconds', 4200)->save();
    self::assertNotSame([], $this->sheet()->save([$cell])['errors']);
  }

  /**
   * The week sheet service.
   */
  private function sheet(): WeekSheet {
    return $this->container->get('bb_track.week_sheet');
  }

  /**
   * A cell rendered for one existing entry.
   */
  private function cell(Worklog $row, string $typed): WeekSheetCell {
    $ticket = $row->get('ticket_id')->target_id;
    return new WeekSheetCell((string) $row->get('work_date')->value, (int) $row->get('project_id')->target_id, $ticket ? (int) $ticket : NULL, $typed, (int) $row->id(), $row->version());
  }

  /**
   * A recorded row of the employee.
   */
  private function recorded(string $date, int $seconds, ?int $ticket = NULL): Worklog {
    return $this->recordedAs($this->employee, $date, $seconds, $ticket);
  }

  /**
   * A recorded row of any owner.
   */
  private function recordedAs(UserInterface $owner, string $date, int $seconds, ?int $ticket = NULL): Worklog {
    $current = $this->container->get('current_user')->getAccount();
    $this->container->get('current_user')->setAccount($owner);
    $row = Worklog::create([
      'owner_user_id' => $owner->id(),
      'work_date' => $date,
      'timezone' => 'UTC',
      'duration_seconds' => $seconds,
      'description' => 'Recorded',
      'project_id' => $this->project->id(),
      'ticket_id' => $ticket,
    ]);
    $row->save();
    $this->container->get('current_user')->setAccount($current);
    return $row;
  }

  /**
   * A proposed row in a fresh proposal of the employee.
   */
  private function proposedRow(string $date, int $seconds): Worklog {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $input = ['work_date' => $date, 'duration_seconds' => $seconds, 'submission_id' => (int) $proposal->id()] + $this->activity('proposal-' . $date);
    return $this->container->get('bb_track.activity_input')->input($input);
  }

  /**
   * The stored row, or NULL when deleted or voided.
   */
  private function reload(Worklog $row): ?Worklog {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache();
    $fresh = $storage->load($row->id());
    return $fresh instanceof Worklog && !$fresh->get('voided')->value ? $fresh : NULL;
  }

  /**
   * The employee's live rows on a day.
   *
   * @return list<\Drupal\bb_track\Entity\Worklog>
   *   Rows.
   */
  private function rowsOn(string $date): array {
    return array_values(array_filter($this->ownRows(), fn (Worklog $row): bool => $row->get('work_date')->value === $date));
  }

  /**
   * The employee's live rows.
   *
   * @return list<\Drupal\bb_track\Entity\Worklog>
   *   Rows.
   */
  private function ownRows(): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache();
    return array_values(array_filter(
      $storage->loadByProperties(['owner_user_id' => $this->employee->id(), 'voided' => 0]),
      static fn (object $entity): bool => $entity instanceof Worklog,
    ));
  }

}
