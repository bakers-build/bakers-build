<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Component\Plugin\Exception\ContextException;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\bb_activity\Activity\ActivityKindInterface;
use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbGroup;
use Drupal\bb_core\Entity\BbProject;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Persists ticket status-change and claim activities transactionally.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class TicketActivityTest extends ActivityEntityKernelTestBase {

  use ActivityKindTestTrait;

  /**
   * A non-admin member used as the initiating actor.
   */
  private UserInterface $writer;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // Consume uid 1 so actor assertions never hit the root account.
    $this->createUser([], 'uid1-dummy', TRUE);
    $writer = $this->createUser(['view bb_ticket']);
    $this->assertInstanceOf(UserInterface::class, $writer);
    $this->writer = $writer;
    $this->setCurrentUser($writer);
  }

  /**
   * An insert records one created row with actor, workflow and first state.
   */
  public function testInsertRecordsCreated(): void {
    $ticket = $this->createWorkTicket('Activity created');
    $ids = $this->activityIds((int) $ticket->id());
    self::assertCount(1, $ids);
    $row = $this->loadActivity($ids[0]);
    self::assertSame('created', $row->get('kind')->value);
    self::assertSame('bb_work', $row->get('workflow')->value);
    self::assertSame('qualification', $row->get('new_state')->value);
    self::assertSame((string) $this->writer->id(), (string) $row->get('actor')->target_id);
    self::assertTrue($row->get('run_id')->isEmpty());
  }

  /**
   * Committed status changes stay distinct; a no-op save records nothing.
   */
  public function testStatusChangesRecordActualPriorAndNewState(): void {
    $ticket = $this->createWorkTicket('Activity state sequence');
    $ticket->set('state', 'plan')->save();
    $ticket->save();
    $ids = $this->activityIds((int) $ticket->id(), 'status_changed');
    self::assertCount(1, $ids);
    $first = $this->loadActivity($ids[0]);
    self::assertSame('status_changed', $first->get('kind')->value);
    self::assertSame('qualification', $first->get('previous_state')->value);
    self::assertSame('plan', $first->get('new_state')->value);
    self::assertSame((string) $this->writer->id(), (string) $first->get('actor')->target_id);
    self::assertTrue($first->get('run_id')->isEmpty());
    self::assertTrue($first->get('comment_id')->isEmpty());
    $ticket->set('state', 'working')->save();
    $ticket->set('state', 'plan')->save();
    $ticket->set('state', 'working')->save();
    self::assertCount(4, $this->activityIds((int) $ticket->id(), 'status_changed'));
  }

  /**
   * A change that ends an active run names that run, its conductor and summary.
   */
  public function testStatusChangeReferencesActiveRunAndItsSummary(): void {
    $ticket = $this->createWorkTicket('Agent status change');
    $ticket->set('state', 'plan')->save();
    $conductor = $this->createConductor();
    $run = $this->createRun($ticket, $conductor, 'plan', 'running');
    $summary = $this->createComment($ticket, 'summary', $this->now());
    $ticket->set('state', 'working')->save();
    $ids = $this->activityIds((int) $ticket->id(), 'status_changed');
    $row = $this->loadActivity((string) array_pop($ids));
    self::assertSame('working', $row->get('new_state')->value);
    self::assertSame((string) $run->id(), (string) $row->get('run_id')->target_id);
    self::assertSame((string) $conductor->id(), (string) $row->get('conductor_id')->target_id);
    self::assertSame((string) $summary->id(), (string) $row->get('comment_id')->target_id);
    self::assertCount(0, $this->activityIds((int) $ticket->id(), 'run_ended'), 'A run closed as done writes no run_ended row.');
  }

  /**
   * A change into a terminal state keeps the run it closes on the status row.
   */
  public function testTerminalTransitionKeepsTheRunItCloses(): void {
    $ticket = $this->createWorkTicket('Terminal status change');
    $ticket->set('state', 'review')->save();
    $conductor = $this->createConductor();
    $run = $this->createRun($ticket, $conductor, 'review', 'running');
    $ticket->set('state', 'done')->save();
    $ids = $this->activityIds((int) $ticket->id(), 'status_changed');
    $row = $this->loadActivity((string) array_pop($ids));
    self::assertSame('done', $row->get('new_state')->value);
    self::assertSame((string) $run->id(), (string) $row->get('run_id')->target_id);
    self::assertSame((string) $conductor->id(), (string) $row->get('conductor_id')->target_id);
    $closed = $this->container->get('entity_type.manager')->getStorage('bb_run')->loadUnchanged($run->id());
    self::assertInstanceOf(BbRunInterface::class, $closed);
    self::assertSame('done', $closed->getRunState());
  }

  /**
   * A human state change links the summary published in the state it left.
   */
  public function testHumanStatusChangeLinksItsStepSummary(): void {
    $ticket = $this->createWorkTicket('Human status change');
    $summary = $this->createComment($ticket, 'summary', $this->now());
    $ticket->set('state', 'plan')->save();
    $ids = $this->activityIds((int) $ticket->id(), 'status_changed');
    $row = $this->loadActivity((string) array_pop($ids));
    self::assertTrue($row->get('run_id')->isEmpty());
    self::assertSame((string) $summary->id(), (string) $row->get('comment_id')->target_id);
  }

  /**
   * A summary older than the ticket's entry into the state is not linked.
   */
  public function testSummaryFromAnEarlierStateIsNotLinked(): void {
    $ticket = $this->createWorkTicket('Stale summary');
    $this->createComment($ticket, 'summary', $this->now() - 3600);
    $ticket->set('state', 'plan')->save();
    $this->createRun($ticket, $this->createConductor(), 'plan', 'claimed');
    $this->createComment($ticket, 'plan', $this->now());
    $ticket->set('state', 'working')->save();
    $ids = $this->activityIds((int) $ticket->id(), 'status_changed');
    $row = $this->loadActivity((string) array_pop($ids));
    self::assertFalse($row->get('run_id')->isEmpty());
    self::assertTrue($row->get('comment_id')->isEmpty());
  }

  /**
   * A summary from the same second as the previous change is not linked twice.
   */
  public function testSummaryLinkedByThePreviousChangeIsNotLinkedAgain(): void {
    $ticket = $this->createWorkTicket('Same second summary');
    $second = $this->now();
    $summary = $this->createComment($ticket, 'summary', $second);
    $ticket->set('state', 'plan')->save();
    $ids = $this->activityIds((int) $ticket->id(), 'status_changed');
    $first = $this->loadActivity((string) array_pop($ids));
    self::assertSame((string) $summary->id(), (string) $first->get('comment_id')->target_id);
    $first->set('created', $second)->save();
    $ticket->set('state', 'working')->save();
    $ids = $this->activityIds((int) $ticket->id(), 'status_changed');
    $row = $this->loadActivity((string) array_pop($ids));
    self::assertSame('working', $row->get('new_state')->value);
    self::assertTrue($row->get('comment_id')->isEmpty());
  }

  /**
   * Only the first run outside qualification writes a claimed row.
   */
  public function testOnlyTheFirstWorkRunRecordsClaim(): void {
    $ticket = $this->createWorkTicket('First work claim');
    $conductor = $this->createConductor();
    $qualification = $this->createRun($ticket, $conductor, 'qualification', 'done');
    $this->claimed($ticket, $qualification, $conductor);
    self::assertCount(0, $this->activityIds((int) $ticket->id(), 'claimed'));
    $plan = $this->createRun($ticket, $conductor, 'plan', 'done');
    $this->claimed($ticket, $plan, $conductor);
    $replan = $this->createRun($ticket, $conductor, 'plan', 'done');
    $this->claimed($ticket, $replan, $conductor);
    $working = $this->createRun($ticket, $conductor, 'working', 'claimed');
    $this->claimed($ticket, $working, $conductor);
    $ids = $this->activityIds((int) $ticket->id(), 'claimed');
    self::assertCount(1, $ids);
    self::assertSame((string) $plan->id(), (string) $this->loadActivity($ids[0])->get('run_id')->target_id);
  }

  /**
   * A claim records the run and conductor the claim service hands the kind.
   */
  public function testClaimRecordsFromTheClaimService(): void {
    $ticket = $this->createWorkTicket('Claim event');
    $conductor = $this->createConductor();
    $run = $this->createRun($ticket, $conductor, 'working', 'claimed');
    $row = $this->claimed($ticket, $run, $conductor);
    self::assertInstanceOf(BbActivity::class, $row);
    self::assertSame((string) $run->id(), (string) $row->get('run_id')->target_id);
    self::assertSame((string) $conductor->id(), (string) $row->get('conductor_id')->target_id);
    self::assertSame('working', $row->get('step')->value);
  }

  /**
   * A run ending failed, expired or cancelled records run_ended; done does not.
   */
  public function testRunEndingWithoutStateChangeRecordsRunEnded(): void {
    $ticket = $this->createWorkTicket('Run outcomes');
    $ticket->set('state', 'plan')->save();
    $conductor = $this->createConductor();
    $ended = [];
    foreach (['failed', 'expired', 'cancelled', 'done'] as $outcome) {
      $run = $this->createRun($ticket, $conductor, 'plan', 'claimed');
      $run->setRunState($outcome)->save();
      $run->save();
      $ended[$outcome] = (string) $run->id();
    }
    $ids = $this->activityIds((int) $ticket->id(), 'run_ended');
    self::assertCount(3, $ids);
    $runs = [];
    foreach ($ids as $id) {
      $row = $this->loadActivity($id);
      self::assertSame('plan', $row->get('step')->value);
      self::assertSame((string) $conductor->id(), (string) $row->get('conductor_id')->target_id);
      $runs[] = (string) $row->get('run_id')->target_id;
    }
    self::assertSame([$ended['failed'], $ended['expired'], $ended['cancelled']], $runs);
  }

  /**
   * A workflow transition writes one status row despite the subscriber.
   */
  public function testWorkflowTransitionRecordsOneStatusChange(): void {
    $ticket = $this->createWorkTicket('Workflow transition uniqueness');
    $ticket->getState()->applyTransitionById('qualify');
    $ticket->save();
    $ids = $this->activityIds((int) $ticket->id(), 'status_changed');
    self::assertCount(1, $ids);
    $row = $this->loadActivity($ids[0]);
    self::assertSame('qualification', $row->get('previous_state')->value);
    self::assertSame('plan', $row->get('new_state')->value);
  }

  /**
   * An outer rollback after an inner save removes ticket and activity.
   */
  public function testOuterRollbackRemovesStatusAndActivity(): void {
    $ticket = $this->createWorkTicket('Outer rollback');
    $id = (int) $ticket->id();
    $transaction = $this->container->get('database')->startTransaction();
    $ticket->set('state', 'plan')->save();
    self::assertCount(1, $this->activityIds($id, 'status_changed'));
    $transaction->rollBack();
    unset($transaction);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([$id]);
    $this->container->get('entity_type.manager')->getStorage('bb_activity')->resetCache();
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    self::assertSame('qualification', $reloaded->get('state')->value);
    self::assertCount(0, $this->activityIds($id, 'status_changed'));
  }

  /**
   * A kind failure after the ticket write rolls the ticket change back.
   */
  public function testKindFailureRollsBackTicketSave(): void {
    $ticket = $this->createWorkTicket('Kind failure');
    $id = (int) $ticket->id();
    $this->failKinds('status_changed');
    try {
      $ticket->set('state', 'plan')->save();
      self::fail('Expected the ticket save to fail with the kind.');
    }
    catch (EntityStorageException) {
    }
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([$id]);
    $this->container->get('entity_type.manager')->getStorage('bb_activity')->resetCache();
    $reloaded = $storage->load($id);
    $this->assertInstanceOf(BbTicketInterface::class, $reloaded);
    self::assertSame('qualification', $reloaded->get('state')->value);
    self::assertCount(0, $this->activityIds($id, 'status_changed'));
  }

  /**
   * Two stale loaded objects record the serialized predecessor, not A→C.
   */
  public function testStaleLoadedObjectsRecordSerializedPredecessor(): void {
    $ticket = $this->createWorkTicket('Stale objects');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $id = (int) $ticket->id();
    $first = $storage->load($id);
    $second = $storage->load($id);
    $this->assertInstanceOf(BbTicketInterface::class, $first);
    $this->assertInstanceOf(BbTicketInterface::class, $second);
    $first->set('state', 'plan')->save();
    $second->set('state', 'working')->save();
    $ids = $this->activityIds($id, 'status_changed');
    self::assertCount(2, $ids);
    $row1 = $this->loadActivity($ids[0]);
    $row2 = $this->loadActivity($ids[1]);
    self::assertSame('qualification', $row1->get('previous_state')->value);
    self::assertSame('plan', $row1->get('new_state')->value);
    self::assertSame('plan', $row2->get('previous_state')->value);
    self::assertSame('working', $row2->get('new_state')->value);
  }

  /**
   * A claim without its run or conductor records nothing.
   */
  public function testClaimedRequiresSavedRunAndConductor(): void {
    $ticket = $this->createWorkTicket('Incomplete claim');
    $conductor = $this->createConductor();
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $this->writer->id(),
      'state' => 'claimed',
      'state_at_start' => 'plan',
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    $kind = $this->container->get('plugin.manager.bb_activity_kind')->createInstance('claimed');
    self::assertInstanceOf(ActivityKindInterface::class, $kind);
    $kind->setContextValue('ticket', $ticket);
    $kind->setContextValue('run', $run);
    try {
      $kind->record();
      self::fail('Expected a claim without its conductor to fail.');
    }
    catch (ContextException) {
    }
    self::assertCount(0, $this->activityIds((int) $ticket->id(), 'claimed'));
  }

  /**
   * A claim of a run that is not saved yet is refused and records nothing.
   */
  public function testClaimedRefusesAnUnsavedRun(): void {
    $ticket = $this->createWorkTicket('Unsaved claim');
    $conductor = $this->createConductor();
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $this->writer->id(),
      'state' => 'claimed',
      'state_at_start' => 'plan',
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    try {
      $this->claimed($ticket, $run, $conductor);
      self::fail('Expected a claim of an unsaved run to fail.');
    }
    catch (\InvalidArgumentException) {
    }
    self::assertCount(0, $this->activityIds((int) $ticket->id(), 'claimed'));
  }

  /**
   * Creates a bb_work ticket in qualification on a saved project.
   */
  private function createWorkTicket(string $title): BbTicketInterface {
    $group = BbGroup::create([
      'name' => 'Activity group',
      'workspace_id' => $this->hostWorkspace->id(),
    ]);
    $group->save();
    $project = BbProject::create([
      'name' => 'activity',
      'key' => 'ACT' . substr(hash('sha256', $title), 0, 6),
      'group_id' => $group->id(),
    ]);
    $project->save();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => $title,
      'project_id' => $project->id(),
      'workflow' => 'bb_work',
    ]);
    $ticket->save();
    $this->assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Creates a conductor in the first project created by this test.
   */
  private function createConductor(): BbConductorInterface {
    $projects = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')->loadMultiple();
    $project = reset($projects);
    $this->assertNotFalse($project);
    $conductor = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->create([
      'label' => 'activity-conductor',
      'owner_user_id' => $this->writer->id(),
      'status' => 'online',
      'project_id' => $project->id(),
      'states' => ['plan', 'working'],
      'last_seen' => $this->container->get('datetime.time')->getRequestTime(),
    ]);
    $conductor->save();
    $this->assertInstanceOf(BbConductorInterface::class, $conductor);
    return $conductor;
  }

  /**
   * Creates a saved run of the ticket started in the given state.
   */
  private function createRun(BbTicketInterface $ticket, BbConductorInterface $conductor, string $step, string $state): BbRunInterface {
    $run = $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $this->writer->id(),
      'state' => $state,
      'state_at_start' => $step,
    ]);
    $this->assertInstanceOf(BbRunInterface::class, $run);
    $run->save();
    return $run;
  }

  /**
   * Creates a comment of a type on the ticket at a given time.
   */
  private function createComment(BbTicketInterface $ticket, string $type, int $created): EntityInterface {
    $comment = $this->container->get('entity_type.manager')->getStorage('bb_comment')->create([
      'ticket_id' => $ticket->id(),
      'author' => $this->writer->id(),
      'body' => ['value' => $type, 'format' => 'bb_rich'],
      'type' => $type,
      'created' => $created,
    ]);
    $comment->save();
    return $comment;
  }

  /**
   * The current wall-clock time the kinds stamp rows with.
   */
  private function now(): int {
    return (int) $this->container->get('datetime.time')->getCurrentTime();
  }

  /**
   * Loads one activity by storage id.
   */
  private function loadActivity(string $id): BbActivity {
    $activity = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')->load($id);
    $this->assertInstanceOf(BbActivity::class, $activity);
    return $activity;
  }

  /**
   * Activity ids for a ticket, optionally restricted by kind, oldest first.
   *
   * @return list<string>
   *   Storage ids.
   */
  private function activityIds(int $ticket_id, ?string $kind = NULL): array {
    $query = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket_id)
      ->sort('id');
    if ($kind !== NULL) {
      $query->condition('kind', $kind);
    }
    return array_values($query->execute());
  }

}
