<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\DataProvider;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Component\Datetime\TimeInterface;
use Drupal\bb_core\Entity\BbTermInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\user\UserInterface;
use Drupal\og\Og;

/**
 * Stored health is maintained through entity saves and cron.
 */
#[Group('bb_core')]
final class TicketHealthTest extends ClaimKernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'file', 'image', 'link', 'text', 'filter',
    'bb_core', 'bb_activity',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_activity');
  }

  /**
   * Controlled time for save and cron boundaries.
   */
  private int $clock;

  /**
   * {@inheritdoc}
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $this->clock = time();
    $time = $this->createMock(TimeInterface::class);
    $time->method('getRequestTime')->willReturnCallback(fn (): int => $this->clock);
    $time->method('getCurrentTime')->willReturnCallback(fn (): int => $this->clock);
    $container->set('datetime.time', $time);
  }

  /**
   * Labels receive a stable identity once, within their workspace.
   */
  public function testLabelIdentitySurvivesRename(): void {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_term');
    $project = $this->conductor->get('project_id')->entity;
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $workspace = $project->getGroup()?->getWorkspace();
    self::assertNotNull($workspace);
    $term = $storage->create(['vid' => 'label', 'workspace_id' => $workspace->id(), 'name' => 'Technical problem']);
    self::assertInstanceOf(BbTermInterface::class, $term);
    $term->save();
    self::assertSame('technical_problem', $term->get('key')->value);
    $term->set('name', 'Renamed')->save();
    self::assertSame('technical_problem', $term->get('key')->value);
    $other = $storage->create(['vid' => 'label', 'workspace_id' => $workspace->id(), 'name' => 'Other']);
    self::assertInstanceOf(BbTermInterface::class, $other);
    $other->save();
    $other->set('name', 'Question')->save();
    self::assertSame('other', $other->get('key')->value);
  }

  /**
   * Every open state can become idle, then recover on an edit.
   */
  public function testIdleAndEditRecovery(): void {
    $ticket = $this->seedAssignedTicket('qualification');
    $now = $this->container->get('datetime.time')->getRequestTime();
    $this->clock += 4 * 86400;
    $ticket = $this->reloadTicket($ticket);
    $health = $this->container->get('bb_core.ticket_health');
    $health->refresh([$ticket]);
    $ticket = $this->reloadTicket($ticket);
    self::assertSame('warning', $ticket->get('health')->value);
    self::assertSame('idle_qualification', $ticket->get('health_reason')->value);
    self::assertSame('In qualification for 4 days', (string) $health->reasonText('idle_qualification', $now - 4 * 86400, $now));
    $ticket->set('title', 'Moved')->save();
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
  }

  /**
   * Labels, run outcomes and conductor status refresh the stored result.
   */
  public function testRulesAndRelationshipExemptions(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->seedRun($ticket, 'working', 'failed');
    self::assertSame('run_failed', $this->reloadTicket($ticket)->get('health_reason')->value);
    $this->seedRun($ticket, 'working', 'running');
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
    $this->conductor->set('status', 'offline')->save();
    self::assertSame('conductor_offline', $this->reloadTicket($ticket)->get('health_reason')->value);
    $this->conductor->set('status', 'online')->save();
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
    $child = $this->seedAssignedTicket('working');
    $child->set('parent_id', $ticket->id())->save();
    $this->conductor->set('status', 'offline')->save();
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
    $child->set('closed', TRUE)->save();
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
    $blocked = $this->seedAssignedTicket('working');
    $blocked->set('blocked_by', [$ticket->id()])->save();
    self::assertSame('healthy', $this->reloadTicket($blocked)->get('health')->value);
    $blocked->set('blocked_by', [])->save();
    self::assertSame('critical', $this->reloadTicket($blocked)->get('health')->value);
  }

  /**
   * Ending a blocker or a parent relationship re-evaluates the other ticket.
   */
  public function testRelationshipEndsReevaluate(): void {
    $blocker = $this->seedAssignedTicket('working');
    $blocked = $this->seedAssignedTicket('working');
    $blocked->set('blocked_by', [$blocker->id()])->save();
    $detached = $this->seedAssignedTicket('working');
    $deleted = $this->seedAssignedTicket('working');
    $children = [];
    foreach ([$detached, $deleted] as $parent) {
      $child = $this->seedAssignedTicket('working');
      $child->set('parent_id', $parent->id())->save();
      $children[] = $child;
    }
    $this->conductor->set('status', 'offline')->save();
    foreach ([$blocked, $detached, $deleted] as $exempt) {
      self::assertSame('healthy', $this->reloadTicket($exempt)->get('health')->value);
    }
    $this->reloadTicket($blocker)->set('closed', TRUE)->save();
    self::assertSame('conductor_offline', $this->reloadTicket($blocked)->get('health_reason')->value);
    $this->reloadTicket($children[0])->set('parent_id', NULL)->save();
    self::assertSame('conductor_offline', $this->reloadTicket($detached)->get('health_reason')->value);
    $this->reloadTicket($children[1])->delete();
    self::assertSame('conductor_offline', $this->reloadTicket($deleted)->get('health_reason')->value);
  }

  /**
   * Time-based changes are hourly, and refresh is otherwise write-free.
   */
  public function testCronStallAndNoopRefresh(): void {
    $ticket = $this->seedAssignedTicket('working');
    $run = $this->seedRun($ticket, 'working', 'running');
    $before = $this->reloadTicket($ticket)->toArray();
    $health = $this->container->get('bb_core.ticket_health');
    $health->refresh([$this->reloadTicket($ticket)]);
    self::assertSame($before, $this->reloadTicket($ticket)->toArray());
    $this->clock += 21601;
    $this->container->get('module_handler')->invokeAll('cron');
    $ticket = $this->reloadTicket($ticket);
    self::assertSame('run_stalled', $ticket->get('health_reason')->value);
    self::assertSame('Run unchanged for 6 h', (string) $health->reasonText('run_stalled', (int) $ticket->get('health_moved')->value, $this->clock));
    $checked = $ticket->get('health_checked')->value;
    $this->clock += 60;
    $this->container->get('module_handler')->invokeAll('cron');
    self::assertSame($checked, $this->reloadTicket($ticket)->get('health_checked')->value);
    $run = $this->reloadRun($run);
    $run->set('state', 'done')->save();
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
  }

  /**
   * Cron leaves healthy tickets alone that moved within the last two days.
   */
  public function testCronSkipsRecentlyMovedHealthyTickets(): void {
    $old = $this->seedAssignedTicket('working');
    $this->clock += 2 * 86400 + 1;
    $recent = $this->seedAssignedTicket('working');
    // A status no save announces; only an evaluated ticket can notice it.
    $this->container->get('database')->update('bb_conductor')->fields(['status' => 'offline'])
      ->condition('id', $this->conductor->id())->execute();
    // Cron runs in its own request, without this request's loaded entities.
    $this->container->get('entity_type.manager')->getStorage('bb_conductor')->resetCache();
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->resetCache();
    $this->container->get('module_handler')->invokeAll('cron');
    self::assertSame('conductor_offline', $this->reloadTicket($old)->get('health_reason')->value);
    self::assertSame('healthy', $this->reloadTicket($recent)->get('health')->value);
  }

  /**
   * State-specific boundaries, including never picked up, are strict.
   */
  #[DataProvider('idleCases')]
  public function testIdleThresholds(string $state, int $days, bool $unassigned, string $reason): void {
    $ticket = $this->seedAssignedTicket($state);
    if ($unassigned) {
      $ticket->set('conductor_id', NULL)->set('assignee_user_id', NULL)->save();
    }
    $health = $this->container->get('bb_core.ticket_health');
    $this->clock += $days * 86400;
    $health->refresh([$this->reloadTicket($ticket)]);
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
    $this->clock++;
    $this->container->get('module_handler')->invokeAll('cron');
    self::assertSame($reason, $this->reloadTicket($ticket)->get('health_reason')->value);
  }

  /**
   * The independent thresholds from the accepted specification.
   *
   * @return array<string, array{string, int, bool, string}>
   *   State, days, unassigned and expected reason.
   */
  public static function idleCases(): array {
    return [
      'qualification' => ['qualification', 2, FALSE, 'idle_qualification'],
      'plan' => ['plan', 2, FALSE, 'idle_plan'],
      'working' => ['working', 3, FALSE, 'idle_working'],
      'review' => ['review', 5, FALSE, 'idle_review'],
      'never picked up' => ['qualification', 3, TRUE, 'not_picked_up'],
    ];
  }

  /**
   * Label identity, priority and closed-ticket handling survive normal saves.
   */
  public function testLabelsAndClosedState(): void {
    $ticket = $this->seedAssignedTicket('working');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_term');
    $project = $this->conductor->get('project_id')->entity;
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $workspace = $project->getGroup()?->getWorkspace();
    self::assertNotNull($workspace);
    $question = $storage->create(['vid' => 'label', 'workspace_id' => $workspace->id(), 'name' => 'Question']);
    self::assertInstanceOf(BbTermInterface::class, $question);
    $question->save();
    $technical = $storage->create(['vid' => 'label', 'workspace_id' => $workspace->id(), 'name' => 'Technical problem']);
    self::assertInstanceOf(BbTermInterface::class, $technical);
    $technical->save();
    $ticket->set('labels', [$question->id()])->save();
    self::assertSame('needs_info', $this->reloadTicket($ticket)->get('health_reason')->value);
    $ticket->set('labels', [$question->id(), $technical->id()])->save();
    self::assertSame('technical_problem', $this->reloadTicket($ticket)->get('health_reason')->value);
    $technical->set('name', 'Renamed')->save();
    $ticket->save();
    self::assertSame('technical_problem', $this->reloadTicket($ticket)->get('health_reason')->value);
    $technical->set('key', 'ordinary')->save();
    self::assertSame('needs_info', $this->reloadTicket($ticket)->get('health_reason')->value);
    $ticket = $this->reloadTicket($ticket);
    $ticket->set('closed', TRUE)->save();
    self::assertNull($this->reloadTicket($ticket)->get('health')->value);
    $ticket->set('closed', FALSE)->set('state', 'working')->save();
    self::assertSame('warning', $this->reloadTicket($ticket)->get('health')->value);
  }

  /**
   * Activity and run state changes move tickets; plain run saves do not.
   */
  public function testRealMovementAndActivity(): void {
    $ticket = $this->seedAssignedTicket('working');
    $run = $this->seedRun($ticket, 'working', 'done');
    $this->clock += 4 * 86400;
    $run->save();
    self::assertSame('idle_working', $this->reloadTicket($ticket)->get('health_reason')->value);
    $this->container->get('entity_type.manager')->getStorage('bb_activity')->create([
      'ticket_id' => $ticket->id(),
      'kind' => 'test',
      'created' => $this->clock,
    ])->save();
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
    $this->clock += 4 * 86400;
    $run->set('state', 'expired')->save();
    self::assertSame('run_expired', $this->reloadTicket($ticket)->get('health_reason')->value);
  }

  /**
   * Movement alone updates an unhealthy ticket without re-dating its check.
   */
  public function testMovementKeepsEvaluationTime(): void {
    $ticket = $this->seedAssignedTicket('working');
    $ticket->set('labels', [$this->label('Question')->id()])->save();
    $checked = $this->reloadTicket($ticket)->get('health_checked')->value;
    $this->clock += 3600;
    $this->container->get('entity_type.manager')->getStorage('bb_activity')->create([
      'ticket_id' => $ticket->id(),
      'kind' => 'test',
      'created' => $this->clock,
    ])->save();
    $ticket = $this->reloadTicket($ticket);
    self::assertSame('needs_info', $ticket->get('health_reason')->value);
    self::assertSame((string) $this->clock, (string) $ticket->get('health_moved')->value);
    self::assertSame($checked, $ticket->get('health_checked')->value);
  }

  /**
   * Creates a label in the conductor's workspace.
   */
  private function label(string $name, array $values = []): BbTermInterface {
    $project = $this->conductor->get('project_id')->entity;
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $term = $this->container->get('entity_type.manager')->getStorage('bb_term')->create($values + [
      'vid' => 'label',
      'workspace_id' => $project->getGroup()?->getWorkspace()?->id(),
      'name' => $name,
    ]);
    self::assertInstanceOf(BbTermInterface::class, $term);
    $term->save();
    return $term;
  }

  /**
   * The upgrade is repeatable and fills old label identities and open health.
   */
  public function testBackfill(): void {
    require_once DRUPAL_ROOT . '/modules/custom/bb_core/bb_core.post_update.php';
    $ticket = $this->seedAssignedTicket('working');
    $closed = $this->seedAssignedTicket('working');
    $closed->set('closed', TRUE)->save();
    $project = $this->conductor->get('project_id')->entity;
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $term = $this->container->get('entity_type.manager')->getStorage('bb_term')->create([
      'vid' => 'label',
      'name' => 'Question',
      'workspace_id' => $project->getGroup()?->getWorkspace()?->id(),
    ]);
    $term->save();
    // A legacy label had no key column. Recreate that input, never health.
    $this->container->get('database')->update('bb_term')->fields(['key' => NULL])->condition('id', $term->id())->execute();
    $this->container->get('entity_type.manager')->getStorage('bb_term')->resetCache();
    $this->clock += 4 * 86400;
    bb_core_post_update_ticket_health_1_fields();
    $sandbox = [];
    do {
      bb_core_post_update_ticket_health_2_labels($sandbox);
    } while ($sandbox['#finished'] !== 1);
    $term = $this->container->get('entity_type.manager')->getStorage('bb_term')->load($term->id());
    self::assertInstanceOf(BbTermInterface::class, $term);
    self::assertSame('question', $term->get('key')->value);
    $sandbox = [];
    do {
      bb_core_post_update_ticket_health_3_tickets($sandbox);
    } while ($sandbox['#finished'] !== 1);
    self::assertSame('idle_working', $this->reloadTicket($ticket)->get('health_reason')->value);
    self::assertNull($this->reloadTicket($closed)->get('health')->value);
  }

  /**
   * Loss of the conductor owner's access is a critical rule.
   */
  public function testOwnerAccessAndRuleOrder(): void {
    $ticket = $this->seedAssignedTicket('working');
    $owner = $this->conductor->get('owner_user_id')->entity;
    self::assertInstanceOf(UserInterface::class, $owner);
    foreach (Og::getMemberships($owner) as $membership) {
      $membership->delete();
    }
    self::assertSame('no_access', $this->reloadTicket($ticket)->get('health_reason')->value);
  }

  /**
   * A label identity cannot be reused in the same workspace and vocabulary.
   */
  public function testUniqueLabelKey(): void {
    $this->label('Question')->set('name', 'Info')->save();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_term');
    $values = ['vid' => 'label', 'workspace_id' => $this->label('Other')->get('workspace_id')->target_id];
    $clash = $storage->create($values + ['name' => 'Question']);
    self::assertInstanceOf(BbTermInterface::class, $clash);
    $violations = $clash->get('name')->validate();
    self::assertCount(1, $violations);
    self::assertStringContainsString('Info', strip_tags((string) $violations->get(0)->getMessage()));
    $spare = $storage->create($values + ['name' => 'Spare', 'key' => 'QUESTION']);
    self::assertInstanceOf(BbTermInterface::class, $spare);
    self::assertCount(1, $spare->get('key')->validate());
    // An unvalidated save still succeeds and leaves the key with its owner.
    $clash->save();
    self::assertCount(1, $storage->loadByProperties(['vid' => 'label', 'key' => 'question']));
  }

  /**
   * An explicit key is stored lowercase and drives its rule.
   */
  public function testExplicitKeyIsLowercase(): void {
    $label = $this->label('Broken', ['key' => 'Technical_Problem']);
    self::assertSame('technical_problem', $label->get('key')->value);
    $ticket = $this->seedAssignedTicket('working');
    $ticket->set('labels', [$label->id()])->save();
    self::assertSame('technical_problem', $this->reloadTicket($ticket)->get('health_reason')->value);
  }

  /**
   * A retained run entity must not save a stale copy of its ticket.
   */
  public function testRunRefreshPreservesTicketEdits(): void {
    $ticket = $this->seedAssignedTicket('working');
    $run = $this->seedRun($ticket, 'working', 'running');
    $edited = $this->reloadTicket($ticket);
    $edited->set('title', 'Keep this edit')->save();
    $run->set('state', 'failed')->save();
    self::assertSame('Keep this edit', $this->reloadTicket($ticket)->label());
  }

  /**
   * A stalled claimed run stops being a stall when its lease expires.
   */
  public function testExpiredStalledLeaseIsRechecked(): void {
    $ticket = $this->seedAssignedTicket('working');
    $this->seedRun($ticket, 'working', 'claimed', $this->clock + 8 * 3600);
    $this->clock += 21601;
    $this->container->get('module_handler')->invokeAll('cron');
    self::assertSame('run_stalled', $this->reloadTicket($ticket)->get('health_reason')->value);
    $this->clock += 3 * 3600;
    $this->container->get('module_handler')->invokeAll('cron');
    self::assertSame('healthy', $this->reloadTicket($ticket)->get('health')->value);
  }

}
