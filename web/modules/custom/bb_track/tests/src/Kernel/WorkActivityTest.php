<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Stable source identity cannot duplicate work or impersonate another owner.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorkActivityTest extends WorkTimeTestBase {

  /**
   * Retries preserve source revision; recorded changes require reconciliation.
   */
  public function testSourceIdentity(): void {
    $input = $this->activity('meeting');
    $source = \Drupal::service('bb_track.activity_input')->input($input);
    self::assertEquals($source->get('source_revision')->value, \Drupal::service('bb_track.activity_input')->input($input)->get('source_revision')->value);
    self::assertSame('bb_track_worklog', $source->getEntityTypeId());
    self::assertSame('recorded', $source->get('state')->value);
    self::assertEquals(7200, $source->get('duration_seconds')->value);
    self::assertFalse($this->container->get('entity_type.manager')->hasDefinition('bb_track_week'));
    $input['source_version'] = '2';
    $this->expectException(\DomainException::class);
    \Drupal::service('bb_track.activity_input')->input($input);
  }

  /**
   * Without an active account the activity is refused, actionably.
   */
  public function testMissingAccountIsRefused(): void {
    // The default cannot be archived through the operation; legacy data
    // without a default is what leaves a project with nothing to resolve.
    $account = $this->container->get('entity_type.manager')->getStorage('bb_track_account')->load($this->accountId);
    assert($account instanceof Account);
    $account->set('is_default', FALSE)->set('active', FALSE)->save();
    $this->expectException(\DomainException::class);
    $this->expectExceptionMessage('No billing account is configured for this project or ticket. Ask a project maintainer to set one.');
    \Drupal::service('bb_track.activity_input')->input($this->activity('no-account'));
  }

  /**
   * A chosen account is booked when it is an active one of the project.
   */
  public function testChosenAccountIsBooked(): void {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'Billed apart',
      'project_id' => $this->project->id(),
      'workflow' => 'bb_feature',
    ]);
    $ticket->save();
    $other = \Drupal::service('bb_track.assignments')->saveAccount((int) $this->project->id(), [
      'name' => 'Ticket work',
    ]);
    $resolved = \Drupal::service('bb_track.activity_input')->input($this->activity('resolved'));
    self::assertEquals($this->accountId, $resolved->get('account_id')->target_id);
    $chosen = \Drupal::service('bb_track.activity_input')->input($this->activity('chosen') + ['account_id' => (int) $other->id()]);
    self::assertEquals($other->id(), $chosen->get('account_id')->target_id);
    $this->expectException(\DomainException::class);
    $this->expectExceptionMessage('Billing account is unavailable or belongs to another project.');
    \Drupal::service('bb_track.activity_input')->input($this->activity('foreign') + ['account_id' => 999999]);
  }

  /**
   * The input contract never accepts an owner override.
   */
  public function testForgedOwner(): void {
    $this->expectException(\InvalidArgumentException::class);
    \Drupal::service('bb_track.activity_input')->input($this->activity('forged') + ['owner_user_id' => $this->peer->id()]);
  }

  /**
   * AI proposals supply concrete minutes; raw weighting input is rejected.
   */
  public function testConcreteProposalRequired(): void {
    $input = $this->activity('weighted');
    unset($input['duration_seconds']);
    $input['intervals'] = [[
      'ai_seconds' => 60,
      'human_seconds' => 0,
      'read_words' => 0,
      'typed_characters' => 0,
      'machine_prompt' => TRUE,
    ],
    ];
    $this->expectException(\InvalidArgumentException::class);
    \Drupal::service('bb_track.activity_input')->input($input);
  }

  /**
   * A duration outside the bound is rejected with the bound in the message.
   */
  public function testOutOfRangeDurationNamesTheBound(): void {
    $input = $this->activity('too-long');
    $input['duration_seconds'] = 86401;
    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('Duration must be whole minutes between 0:01 and 24:00.');
    \Drupal::service('bb_track.activity_input')->input($input);
  }

  /**
   * Submitted minutes remain unchanged regardless of the user's template.
   */
  public function testAiDurationIsNotAllocated(): void {
    \Drupal::service('bb_track.settings')->saveSchedule([28800, 28800, 28800, 28800, 0, 0, 0], NULL);
    $input = $this->activity('ai-proposal');
    $input['duration_seconds'] = 5460;
    $source = \Drupal::service('bb_track.activity_input')->input($input);
    self::assertEquals(5460, $source->get('duration_seconds')->value);
  }

  /**
   * Deleting recorded work never makes its source eligible for another booking.
   */
  public function testDeletedSourceCannotBeReimported(): void {
    $input = $this->activity('deleted-source');
    $service = \Drupal::service('bb_track.activity_input');
    $source = $service->input($input);
    $entry = Worklog::load($source->id());
    $entry->set('source_keys', []);
    $entry->set('source_data', '{}');
    $entry->delete();
    self::assertTrue((bool) Worklog::load($source->id())->get('voided')->value);
    self::assertSame($source->uuid(), $service->input($input)->uuid());
    $input['source_version'] = '2';
    $this->expectException(\DomainException::class);
    $service->input($input);
  }

  /**
   * Direct writes cannot manufacture approval after retiring week operations.
   */
  public function testDirectStateForgeryIsDenied(): void {
    $entry = \Drupal::service('bb_track.activity_input')->input($this->activity('raw-transition'));
    $entry->set('state', 'approved');
    $this->expectException(\DomainException::class);
    $entry->save();
  }

  /**
   * Activity into a proposal stays unbooked and retries return the same row.
   */
  public function testActivityIntoProposalIsUnbooked(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $service = $this->container->get('bb_track.activity_input');
    $row = $service->input($this->activity('p1') + ['submission_id' => (int) $proposal->id()]);
    self::assertSame('proposed', $row->get('state')->value);
    $retry = $service->input($this->activity('p1') + ['submission_id' => (int) $proposal->id()]);
    self::assertSame($row->uuid(), $retry->uuid());
  }

  /**
   * A discarded proposal accepts no activity at all.
   */
  public function testActivityIntoDiscardedProposalIsRejected(): void {
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $this->container->get('bb_track.proposals')->discard($proposal);
    $this->expectException(\DomainException::class);
    $this->container->get('bb_track.activity_input')
      ->input($this->activity('late') + ['submission_id' => (int) $proposal->id()]);
  }

  /**
   * A submitted submission keeps its rows but accepts no new activity.
   */
  public function testSubmittedSubmissionRejectsNewActivity(): void {
    $submission = Submission::create();
    $submission->save();
    $service = $this->container->get('bb_track.activity_input');
    $row = $service->input($this->activity('kept') + ['submission_id' => (int) $submission->id()]);
    $submission->set('state', 'submitted')->save();
    self::assertSame($row->uuid(), $service->input($this->activity('kept') + ['submission_id' => (int) $submission->id()])->uuid());
    $this->expectException(\DomainException::class);
    $service->input($this->activity('new') + ['submission_id' => (int) $submission->id()]);
  }

}
