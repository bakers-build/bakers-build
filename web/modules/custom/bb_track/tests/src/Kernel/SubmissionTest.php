<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Entity\Submission;
use PHPUnit\Framework\Attributes\Group;

/**
 * Submissions group worklogs without changing their editable recorded state.
 */
#[Group('bb_track')]
final class SubmissionTest extends WorkTimeTestBase {

  /**
   * Submission preserves every entry, its identity and ordinary corrections.
   */
  public function testSubmissionLeavesEntriesEditable(): void {
    $submission = Submission::create();
    $submission->save();
    self::assertSame('draft', $submission->get('state')->value);
    $input = $this->activity('submission-first') + ['submission_id' => (int) $submission->id()];
    $service = $this->container->get('bb_track.activity_input');
    $first = $service->input($input);
    $second = $service->input($this->activity('submission-second') + ['submission_id' => (int) $submission->id()]);
    $before = [$first->toArray(), $second->toArray()];
    $submission->set('state', 'submitted')->save();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache();
    self::assertEquals($before, [$storage->load($first->id())->toArray(), $storage->load($second->id())->toArray()]);
    self::assertSame($first->uuid(), $service->input($input)->uuid());
    $first = $storage->load($first->id());
    self::assertInstanceOf(Worklog::class, $first);
    self::assertTrue($first->access('update'));
    $first->set('description', 'Corrected after submission')->set('duration_seconds', 5460)->save();
    $corrected = $storage->loadUnchanged($first->id());
    self::assertInstanceOf(Worklog::class, $corrected);
    self::assertSame('Corrected after submission', $corrected->get('description')->value);
    self::assertEquals(5460, $corrected->get('duration_seconds')->value);
    self::assertSame('submitted', Submission::load($submission->id())->get('state')->value);
  }

  /**
   * A peer cannot read, update, query or attach another owner's submission.
   */
  public function testForeignSubmissionIsUnavailable(): void {
    $submission = Submission::create();
    $submission->save();
    self::assertFalse($submission->access('view', $this->peer));
    self::assertFalse($submission->access('update', $this->peer));
    self::assertFalse($submission->access('delete', $this->employee));
    $this->container->get('current_user')->setAccount($this->peer);
    $ids = $this->container->get('entity_type.manager')->getStorage('bb_track_submission')->getQuery()->accessCheck(TRUE)->execute();
    self::assertSame([], $ids);
    $this->expectException(\DomainException::class);
    $this->container->get('bb_track.activity_input')->input($this->activity('foreign-submission') + ['submission_id' => (int) $submission->id()]);
  }

  /**
   * Ordinary edits cannot silently move worklog between submissions.
   */
  public function testSubmissionReferenceCannotBeReassigned(): void {
    $submission = Submission::create();
    $submission->save();
    $entry = $this->container->get('bb_track.activity_input')->input($this->activity('immutable-submission') + ['submission_id' => (int) $submission->id()]);
    $entry->set('submission_id', NULL);
    $this->expectException(\DomainException::class);
    $entry->save();
  }

  /**
   * Proposals leave their state only through the proposal services.
   */
  public function testProposalStatesAndTransitions(): void {
    $submission = Submission::create(['state' => 'proposed']);
    $submission->save();
    self::assertSame('proposed', Submission::load($submission->id())->get('state')->value);
    foreach (['draft', 'discarded', 'submitted'] as $forbidden) {
      self::assertRejected(Submission::load($submission->id())->set('state', $forbidden), "proposed -> $forbidden");
    }
    self::assertRejected(Submission::create(['state' => 'submitted']), 'new submitted');
    $draft = Submission::create();
    $draft->save();
    $draft->set('state', 'submitted')->save();
    self::assertSame('submitted', Submission::load($draft->id())->get('state')->value);
    self::assertRejected(Submission::load($draft->id())->set('state', 'draft'), 'submitted -> draft');
  }

  /**
   * Asserts that saving the submission is refused by its state rules.
   */
  private static function assertRejected(Submission $submission, string $case): void {
    try {
      $submission->save();
      self::fail("$case must be rejected.");
    }
    catch (EntityStorageException $error) {
      self::assertInstanceOf(\DomainException::class, $error->getPrevious(), $case);
    }
  }

}
