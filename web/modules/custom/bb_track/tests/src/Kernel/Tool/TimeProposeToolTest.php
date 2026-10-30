<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel\Tool;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A proposal is one unbooked submission of the caller's entries, or nothing.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class TimeProposeToolTest extends TimeToolTestBase {

  /**
   * Every entry lands as a proposed row of one proposed submission.
   */
  public function testEntriesBecomeOneProposal(): void {
    $out = $this->outputs($this->runTool('bakers_time_propose', [
      'project' => $this->project->uuid(),
      'entries' => [$this->entry('a'), $this->entry('b', 1800), $this->entry('c', 600)],
    ]));
    $submission = $this->container->get('entity.repository')->loadEntityByUuid('bb_track_submission', $out['submission']);
    assert($submission instanceof Submission);
    self::assertSame('proposed', $submission->get('state')->value);
    self::assertSame($this->employee->id(), $submission->getOwnerId());
    self::assertCount(3, $out['worklogs']);
    $seconds = [];
    foreach ($out['worklogs'] as $uuid) {
      $row = $this->container->get('entity.repository')->loadEntityByUuid('bb_track_worklog', $uuid);
      assert($row instanceof Worklog);
      self::assertSame('proposed', $row->get('state')->value);
      self::assertSame($this->employee->id(), $row->get('owner_user_id')->target_id);
      self::assertSame($submission->id(), $row->get('submission_id')->target_id);
      self::assertSame($this->project->id(), $row->get('project_id')->target_id);
      $seconds[] = (int) $row->get('duration_seconds')->value;
    }
    self::assertSame([7200, 1800, 600], $seconds);
  }

  /**
   * One bad entry among good ones creates nothing and names the entry.
   */
  public function testBadEntryRollsBackEverything(): void {
    $this->container->get('bb_track.activity_input')->input($this->activity('recorded'));
    $bad = [
      'forged owner' => [
        $this->entry('forged') + ['owner_user_id' => (int) $this->peer->id()],
        'forged',
        'owner and approval fields are not accepted',
      ],
      'raw id' => [
        $this->entry('raw') + ['project_id' => (int) $this->project->id()],
        'raw',
        'owner and approval fields are not accepted',
      ],
      'changed source' => [['description' => 'Changed'] + $this->entry('recorded'), 'recorded', 'already recorded'],
      'unknown project' => [
        ['project' => $this->container->get('uuid')->generate()] + $this->entry('hidden'),
        'hidden',
        'Assignment unavailable.',
      ],
      'invalid date' => [['work_date' => '2026-02-30'] + $this->entry('date'), 'date', 'Entry 2 (date)'],
    ];
    foreach ($bad as $case => [$entry, $key, $message]) {
      $result = $this->runTool('bakers_time_propose', [
        'project' => $this->project->uuid(),
        'entries' => [$this->entry('good-1'), $entry, $this->entry('good-2')],
      ]);
      $this->assertFailure($result, "Entry 2 ($key)");
      $this->assertFailure($result, $message);
      self::assertSame(0, $this->stored('bb_track_submission'), $case);
      self::assertSame(1, $this->stored('bb_track_worklog'), $case);
    }
  }

  /**
   * Resending a stored proposal duplicates nothing and stores no submission.
   */
  public function testResendIsRefused(): void {
    $values = ['project' => $this->project->uuid(), 'entries' => [$this->entry('once')]];
    $this->outputs($this->runTool('bakers_time_propose', $values));
    $this->assertFailure($this->runTool('bakers_time_propose', $values), 'Entry 1 (once): This source was already recorded.');
    self::assertSame(1, $this->stored('bb_track_submission'));
    self::assertSame(1, $this->stored('bb_track_worklog'));
  }

  /**
   * Anonymous callers cannot propose time.
   */
  public function testAnonymousIsDenied(): void {
    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $result = $this->runTool('bakers_time_propose', [
      'project' => $this->project->uuid(),
      'entries' => [$this->entry('anon')],
    ]);
    self::assertFalse($result->isSuccess());
    self::assertSame(0, $this->stored('bb_track_worklog'));
  }

  /**
   * A tool entry: the activity fields with UUID references.
   *
   * @return array<string, mixed>
   *   The entry.
   */
  private function entry(string $key, int $seconds = 7200): array {
    $entry = $this->activity($key, $seconds);
    unset($entry['project_id']);
    return $entry;
  }

  /**
   * Stored rows of an entity type, regardless of access.
   */
  private function stored(string $type): int {
    return (int) $this->container->get('entity_type.manager')->getStorage($type)->getQuery()->accessCheck(FALSE)->count()->execute();
  }

}
