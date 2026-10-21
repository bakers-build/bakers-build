<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * AI proposals stay unbooked, editable by their owner and discardable.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class ProposalsTest extends WorkTimeTestBase {

  /**
   * Discard removes the proposed rows, closes the proposal and is repeatable.
   */
  public function testDiscardRemovesRowsAndBlocksResurrection(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $input = $this->activity('d1') + ['submission_id' => (int) $proposal->id()];
    $this->container->get('bb_track.activity_input')->input($input);
    $proposals = $this->container->get('bb_track.proposals');
    self::assertSame(1, $proposals->discard(Submission::load($proposal->id())));
    self::assertSame(0, $proposals->discard(Submission::load($proposal->id())));
    self::assertSame('discarded', Submission::load($proposal->id())->get('state')->value);
    self::assertSame([], $this->visibleWorklogIds());
    $this->expectException(\DomainException::class);
    $this->container->get('bb_track.activity_input')->input($input);
  }

  /**
   * Another employee cannot discard a proposal.
   */
  public function testForeignDiscardIsRejected(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $this->container->get('current_user')->setAccount($this->peer);
    try {
      $this->container->get('bb_track.proposals')->discard($proposal);
      self::fail('A peer must not discard a foreign proposal.');
    }
    catch (\DomainException) {
    }
    self::assertSame('proposed', Submission::load($proposal->id())->get('state')->value);
  }

  /**
   * The owner edits a proposed row like recorded time but cannot book it.
   */
  public function testOwnerEditsProposedRowButCannotBookIt(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $row = $this->container->get('bb_track.activity_input')
      ->input($this->activity('edit') + ['submission_id' => (int) $proposal->id()]);
    $row = Worklog::load($row->id());
    $row->set('duration_seconds', 3600)->set('description', 'Refined')->save();
    self::assertEquals(3600, Worklog::load($row->id())->get('duration_seconds')->value);
    $row = Worklog::load($row->id());
    $row->set('state', 'recorded');
    $this->expectException(\DomainException::class);
    $row->save();
  }

  /**
   * Ordinary creates join only own, open submissions in the matching state.
   */
  public function testOrdinaryCreateJoinsOnlyOpenOwnSubmissions(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $this->manualRow(['submission_id' => $proposal->id(), 'state' => 'proposed'])->save();
    try {
      $this->manualRow(['submission_id' => $proposal->id(), 'state' => 'recorded'])->save();
      self::fail('A recorded row cannot join a proposal.');
    }
    catch (\DomainException) {
    }
    $draft = Submission::create();
    $draft->save();
    $this->manualRow(['submission_id' => $draft->id()])->save();
    $draft->set('state', 'submitted')->save();
    $this->expectException(\DomainException::class);
    $this->manualRow(['submission_id' => $draft->id()])->save();
  }

  /**
   * Saves every date and each same-day row, with duplicate-safe replay.
   */
  public function testSaveWholeProposalAndReplay(): void {
    [$proposal, $changes, $versions] = $this->reviewProposal();
    $service = $this->container->get('bb_track.proposals');
    self::assertCount(3, $service->rows($proposal));
    self::assertSame(3, $service->save($proposal, $changes, $versions));
    self::assertSame('draft', Submission::load($proposal->id())->get('state')->value);
    foreach ($service->rows($proposal) as $row) {
      self::assertSame('recorded', $row->get('state')->value);
      self::assertEquals(4500, $row->get('duration_seconds')->value);
      self::assertSame('Reviewed activity', $row->get('description')->value);
    }
    self::assertSame(0, $service->save($proposal, $changes, $versions));
  }

  /**
   * One invalid row leaves every date and the submission unbooked.
   */
  public function testInvalidSaveIsAtomic(): void {
    [$proposal, $changes, $versions] = $this->reviewProposal();
    $changes[array_key_last($changes)]['description'] = '';
    try {
      $this->container->get('bb_track.proposals')->save($proposal, $changes, $versions);
      self::fail('Blank description must reject the complete submission.');
    }
    catch (\DomainException) {
    }
    foreach ($this->container->get('bb_track.proposals')->rows($proposal) as $row) {
      self::assertSame('proposed', $row->get('state')->value);
      self::assertNotSame('Reviewed activity', $row->get('description')->value);
    }
    self::assertSame('proposed', Submission::load($proposal->id())->get('state')->value);
  }

  /**
   * Concurrent additions are never silently included in an unseen save.
   */
  public function testAddedRowRequiresReload(): void {
    [$proposal, $changes, $versions] = $this->reviewProposal();
    $this->container->get('bb_track.activity_input')->input($this->activity('late') + ['submission_id' => (int) $proposal->id()]);
    $this->expectException(\DomainException::class);
    $this->container->get('bb_track.proposals')->save($proposal, $changes, $versions);
  }

  /**
   * Concurrent edits cannot be overwritten by the review form.
   */
  public function testChangedRowRequiresReload(): void {
    [$proposal, $changes, $versions] = $this->reviewProposal();
    Worklog::load(array_key_first($changes))->set('description', 'Changed elsewhere')->save();
    $this->expectException(\DomainException::class);
    $this->container->get('bb_track.proposals')->save($proposal, $changes, $versions);
  }

  /**
   * A removed activity cannot be resurrected by an old review form.
   */
  public function testDeletedRowRequiresReload(): void {
    [$proposal, $changes, $versions] = $this->reviewProposal();
    Worklog::load(array_key_first($changes))->delete();
    $this->expectException(\DomainException::class);
    $this->container->get('bb_track.proposals')->save($proposal, $changes, $versions);
  }

  /**
   * An unavailable target rejects the entire proposal before any writes.
   */
  public function testInvalidTargetIsAtomic(): void {
    [$proposal, $changes, $versions] = $this->reviewProposal();
    $changes[array_key_last($changes)]['ticket_id'] = 999999;
    try {
      $this->container->get('bb_track.proposals')->save($proposal, $changes, $versions);
      self::fail('An invalid target must reject all dates.');
    }
    catch (\DomainException) {
    }
    foreach ($this->container->get('bb_track.proposals')->rows($proposal) as $row) {
      self::assertSame('proposed', $row->get('state')->value);
      self::assertNotSame('Reviewed activity', $row->get('description')->value);
    }
  }

  /**
   * Neither read nor save may use another employee's proposal.
   */
  public function testForeignSaveRejected(): void {
    [$proposal, $changes, $versions] = $this->reviewProposal();
    $this->container->get('current_user')->setAccount($this->peer);
    $this->expectException(\DomainException::class);
    $this->container->get('bb_track.proposals')->save($proposal, $changes, $versions);
  }

  /**
   * Several rows, including two on one date and a later week.
   *
   * @return array
   *   Proposal, desired changes and original versions.
   */
  private function reviewProposal(): array {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $changes = $versions = [];
    foreach (['2026-08-03', '2026-08-03', '2026-08-17'] as $index => $date) {
      $input = $this->activity('review-' . $index);
      $input['work_date'] = $date;
      $row = $this->container->get('bb_track.activity_input')->input($input + ['submission_id' => (int) $proposal->id()]);
      $changes[(int) $row->id()] = [
        'duration_seconds' => 4500,
        'description' => 'Reviewed activity',
        'project_id' => (int) $this->project->id(),
        'ticket_id' => NULL,
      ];
      $versions[(int) $row->id()] = $row->version();
    }
    return [$proposal, $changes, $versions];
  }

  /**
   * An unsaved manual row of the current employee.
   */
  private function manualRow(array $values): Worklog {
    return Worklog::create($values + [
      'owner_user_id' => $this->employee->id(),
      'work_date' => '2026-08-03',
      'timezone' => 'UTC',
      'duration_seconds' => 1800,
      'description' => 'Manual',
      'project_id' => $this->project->id(),
    ]);
  }

  /**
   * Worklog ids the current employee can read.
   *
   * @return list<int|string>
   *   Ids.
   */
  private function visibleWorklogIds(): array {
    return array_values($this->container->get('entity_type.manager')->getStorage('bb_track_worklog')
      ->getQuery()->accessCheck(TRUE)->execute());
  }

}
