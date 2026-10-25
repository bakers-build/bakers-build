<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\QueryAccess\Condition;
use Drupal\entity\QueryAccess\ConditionGroup;
use Drupal\entity\QueryAccess\QueryAccessHandlerInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\jsonapi\JsonApiFilter;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Activity item, query and related-field access follow the parent ticket.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class TicketActivityAccessTest extends KernelTestBase {

  use ActivityKindTestTrait;

  use WorkspaceReadScopeTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image', 'serialization', 'jsonapi',
    'bb_core', 'bb_activity',
  ];

  /**
   * Workspace A member with ticket view only.
   */
  private UserInterface $memberA;

  /**
   * Workspace B member with ticket view only.
   */
  private UserInterface $memberB;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('bb_notification_setting');
    $this->installReadScopeEnvironment();
    $this->installEntitySchema('bb_activity');
    // Offset project ids so they cannot equal ticket ids. A Views/query
    // condition that compared ticket_id to project ids would otherwise pass
    // on sqlite's per-table sequences (both sides starting at 1).
    $this->createEntity('bb_project', ['name' => 'id-offset']);
    $this->buildTwoWorkspaceWorld();
    $this->assertDistinctTicketAndProjectIds();
    $this->recordActivities();
    $this->memberA = $this->scopeMember('a');
    $this->memberB = $this->scopeMember('b');
  }

  /**
   * Member A sees only A's activities on item, query and count surfaces.
   */
  public function testMemberSeesOnlyOwnTicketActivities(): void {
    $activityA = $this->statusActivity('a');
    $activityB = $this->statusActivity('b');

    self::assertTrue($activityA->access('view', $this->memberA));
    self::assertFalse($activityA->access('view', $this->memberB));
    self::assertFalse($activityB->access('view', $this->memberA));
    self::assertTrue($activityB->access('view', $this->memberB));

    $idsA = $this->queryIdsAs('bb_activity', $this->memberA);
    $idsB = $this->queryIdsAs('bb_activity', $this->memberB);
    sort($idsA);
    sort($idsB);
    self::assertSame($this->activityIdsOnSide('a'), $idsA);
    self::assertSame($this->activityIdsOnSide('b'), $idsB);
    self::assertNotContains((int) $activityB->id(), $idsA);
    self::assertNotContains((int) $activityA->id(), $idsB);

    self::assertSame(count($idsA), $this->queryCountAs($this->memberA));
    self::assertSame(count($idsB), $this->queryCountAs($this->memberB));

    $unfiltered = array_map(
      'intval',
      array_values($this->container->get('entity_type.manager')
        ->getStorage('bb_activity')
        ->getQuery()
        ->accessCheck(FALSE)
        ->execute()),
    );
    sort($unfiltered);
    $expected = array_merge($this->activityIdsOnSide('a'), $this->activityIdsOnSide('b'));
    sort($expected);
    self::assertSame($expected, $unfiltered);
  }

  /**
   * A privileged rank in B does not open A's activities.
   */
  public function testPrivilegedRankInOtherWorkspaceSeesNoneOfForeignActivities(): void {
    $lead = $this->scopeMember('b', 'lead-b', ['lead']);

    self::assertFalse($this->statusActivity('a')->access('view', $lead));
    self::assertNotContains(
      (int) $this->statusActivity('a')->id(),
      $this->queryIdsAs('bb_activity', $lead),
    );
    $leadIds = $this->queryIdsAs('bb_activity', $lead);
    sort($leadIds);
    self::assertSame($this->activityIdsOnSide('b'), $leadIds);
  }

  /**
   * Query conditions are built for the supplied account, not the ambient user.
   */
  public function testQueryConditionsFollowSuppliedAccountNotCurrentUser(): void {
    $this->container->get('account_switcher')->switchTo($this->memberA);
    try {
      $conditions = $this->activityConditions($this->memberB);
    }
    finally {
      $this->container->get('account_switcher')->switchBack();
    }
    self::assertFalse($conditions->isAlwaysFalse());
    self::assertSame(
      [(int) $this->fixture('b', 'bb_ticket')->id()],
      $this->ticketIdsFrom($conditions),
    );
  }

  /**
   * An account with no readable tickets gets an always-false condition.
   */
  public function testEmptyReadableTicketSetIsAlwaysFalse(): void {
    $stranger = $this->createAccount('stranger', ['view bb_ticket']);
    $conditions = $this->activityConditions($stranger);
    self::assertTrue($conditions->isAlwaysFalse());
    self::assertSame([], $this->queryIdsAs('bb_activity', $stranger));
    self::assertSame(0, $this->queryCountAs($stranger));
  }

  /**
   * A dangling parent ticket forbids the activity, including for an admin.
   */
  public function testDanglingTicketForbidsView(): void {
    $activity = $this->statusActivity('a');
    $this->fixture('a', 'bb_ticket')->delete();
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_activity')
      ->resetCache();
    $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->resetCache([(int) $activity->id()]);
    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->load($activity->id());
    self::assertInstanceOf(ContentEntityInterface::class, $reloaded);

    $admin = $this->createAccount('activity-admin', ['administer bakers']);
    self::assertFalse($reloaded->access('view', $this->memberA));
    self::assertFalse($reloaded->access('view', $admin));
    self::assertNotContains(
      (int) $reloaded->id(),
      $this->queryIdsAs('bb_activity', $this->memberA),
    );
  }

  /**
   * Create, update, delete and field edit stay forbidden, including for admins.
   */
  public function testMutationsAreForbiddenIncludingForAdmins(): void {
    $admin = $this->createAccount('mutate-admin', ['administer bakers']);
    $activity = $this->statusActivity('a');
    $handler = $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_activity');

    self::assertFalse($handler->createAccess(NULL, $admin));
    self::assertFalse($activity->access('update', $admin));
    self::assertFalse($activity->access('delete', $admin));
    self::assertFalse($activity->get('actor')->access('edit', $admin));
    self::assertFalse($activity->get('ticket_id')->access('edit', $admin));
    self::assertFalse($activity->access('update', $this->memberA));
    self::assertFalse($activity->access('delete', $this->memberA));
  }

  /**
   * Related run, conductor and actor fields consult target access.
   */
  public function testRelatedFieldsHideUnreadableAndMissingTargets(): void {
    $claimed = $this->claimedActivity('a');
    $run = $this->fixture('a', 'bb_run');
    self::assertFalse($claimed->get('run_id')->access('view', $this->memberA));
    self::assertFalse($claimed->get('conductor_id')->access('view', $this->memberA));
    self::assertFalse($claimed->get('actor')->access('view', $this->memberA));

    $withRelated = $this->scopeMember('a', 'related-a', ['contributor']);
    self::assertTrue($claimed->get('run_id')->access('view', $withRelated));
    self::assertTrue($claimed->get('conductor_id')->access('view', $withRelated));

    $runUuid = $run->uuid();
    $run->delete();
    $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->resetCache([(int) $claimed->id()]);
    $reloaded = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->load($claimed->id());
    self::assertInstanceOf(ContentEntityInterface::class, $reloaded);
    self::assertFalse($reloaded->get('run_id')->access('view', $withRelated));
    self::assertNull($reloaded->get('run_id')->entity);
    self::assertNotSame('', $runUuid);
  }

  /**
   * The summary reference follows comment access and hides a deleted target.
   */
  public function testSummaryReferenceHidesUnreadableAndMissingComments(): void {
    $ticket = $this->fixture('a', 'bb_ticket');
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $run = $this->fixture('a', 'bb_run');
    $run->set('state_at_start', 'plan')->save();
    $summary = $this->createEntity('bb_comment', [
      'ticket_id' => $ticket->id(),
      'author' => $this->memberA->id(),
      'body' => ['value' => 'summary-a'],
      'type' => 'summary',
      'created' => $this->container->get('datetime.time')->getCurrentTime(),
    ]);
    $ticket->set('state', 'working')->save();
    $status = $this->activitiesOnSide('a', 'status_changed');
    $row = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->load($status[array_key_last($status)]);
    self::assertInstanceOf(ContentEntityInterface::class, $row);
    self::assertSame((string) $summary->id(), (string) $row->get('comment_id')->target_id);
    self::assertTrue($row->get('comment_id')->access('view', $this->memberA));
    self::assertFalse($row->get('comment_id')->access('view', $this->memberB));
    self::assertFalse($row->get('comment_id')->access('edit', $this->createAccount('summary-admin', ['administer bakers'])));

    $summary->delete();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $storage->resetCache([(int) $row->id()]);
    $reloaded = $storage->load($row->id());
    self::assertInstanceOf(ContentEntityInterface::class, $reloaded);
    self::assertFalse($reloaded->get('comment_id')->access('view', $this->memberA));
  }

  /**
   * Removing membership invalidates a previously permitted read.
   */
  public function testRemovedMembershipDropsPreviouslyReadableActivities(): void {
    $activity = $this->statusActivity('a');
    self::assertTrue($activity->access('view', $this->memberA));
    self::assertSame($this->activityIdsOnSide('a'), $this->queryIdsAs('bb_activity', $this->memberA));

    $this->addMembership($this->fixture('a', 'bb_workspace'), $this->memberA, ['member'])->delete();
    $this->addMembership($this->fixture('a', 'bb_team'), $this->memberA, [])->delete();
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_activity')
      ->resetCache();
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_ticket')
      ->resetCache();

    self::assertFalse($activity->access('view', $this->memberA));
    self::assertSame([], $this->queryIdsAs('bb_activity', $this->memberA));
  }

  /**
   * JSON:API filter access is granted for a narrowed activity query.
   */
  public function testJsonApiFilterAccessGrantedForReadableTickets(): void {
    self::assertFalse($this->activityConditions($this->memberA)->isAlwaysFalse());
    self::assertTrue($this->filterAccess($this->memberA)->isAllowed());
    $stranger = $this->createAccount('filter-stranger', ['view bb_ticket']);
    self::assertTrue($this->activityConditions($stranger)->isAlwaysFalse());
    self::assertFalse($this->filterAccess($stranger)->isAllowed());
  }

  /**
   * Records one status change and one claim per workspace side.
   */
  private function recordActivities(): void {
    $actor = $this->createAccount('activity-writer');
    $this->container->get('account_switcher')->switchTo($actor);
    try {
      foreach (['a', 'b'] as $side) {
        $ticket = $this->fixture($side, 'bb_ticket');
        self::assertInstanceOf(BbTicketInterface::class, $ticket);
        $ticket->set('state', 'plan')->save();
        $run = $this->fixture($side, 'bb_run');
        $conductor = $this->fixture($side, 'bb_conductor');
        self::assertInstanceOf(BbRunInterface::class, $run);
        self::assertInstanceOf(BbConductorInterface::class, $conductor);
        $this->claimed($ticket, $run, $conductor);
      }
    }
    finally {
      $this->container->get('account_switcher')->switchBack();
    }
  }

  /**
   * Own-side ticket ids differ from that side's project ids.
   *
   * B's ticket collides with A's project. A wrong-column
   * `ticket_id IN project ids` condition would leak B's rows to A.
   */
  private function assertDistinctTicketAndProjectIds(): void {
    foreach (['a', 'b'] as $side) {
      self::assertNotEquals(
        (int) $this->fixture($side, 'bb_ticket')->id(),
        (int) $this->fixture($side, 'bb_project')->id(),
        "Ticket and project ids on side $side must differ.",
      );
    }
    self::assertSame(
      (int) $this->fixture('b', 'bb_ticket')->id(),
      (int) $this->fixture('a', 'bb_project')->id(),
      "B's ticket id must equal A's project id so a ticket_id/project_id mix-up leaks.",
    );
  }

  /**
   * Scopes an account into one side through OG ranks, not a Drupal view grant.
   *
   * A site-wide `view bb_ticket` would pass the rank fence on every ticket.
   * Guest reads tickets; contributor also reads runs and conductors.
   *
   * @param string $side
   *   Workspace side.
   * @param string|null $name
   *   Optional account name; the fixture member is reused when omitted.
   * @param array<string> $workspace_roles
   *   Workspace OG role names.
   *
   * @return \Drupal\user\UserInterface
   *   The scoped account.
   */
  private function scopeMember(string $side, ?string $name = NULL, array $workspace_roles = ['guest']): UserInterface {
    $account = $name === NULL
      ? $this->member($side)
      : $this->createAccount($name);
    $this->addMembership($this->fixture($side, 'bb_workspace'), $account, $workspace_roles);
    $this->addMembership($this->fixture($side, 'bb_team'), $account, []);
    return $account;
  }

  /**
   * Status-changed activity on one side.
   */
  private function statusActivity(string $side): ContentEntityInterface {
    $ids = $this->activitiesOnSide($side, 'status_changed');
    self::assertNotSame([], $ids);
    $activity = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->load($ids[0]);
    self::assertInstanceOf(ContentEntityInterface::class, $activity);
    return $activity;
  }

  /**
   * Claimed activity on one side.
   */
  private function claimedActivity(string $side): ContentEntityInterface {
    $ids = $this->activitiesOnSide($side, 'claimed');
    self::assertNotSame([], $ids);
    $activity = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->load($ids[0]);
    self::assertInstanceOf(ContentEntityInterface::class, $activity);
    return $activity;
  }

  /**
   * Activity ids on one side, sorted.
   *
   * @return array<int>
   *   Entity ids.
   */
  private function activityIdsOnSide(string $side): array {
    $ids = array_merge(
      $this->activitiesOnSide($side, 'created'),
      $this->activitiesOnSide($side, 'status_changed'),
      $this->activitiesOnSide($side, 'claimed'),
      $this->activitiesOnSide($side, 'run_ended'),
    );
    sort($ids);
    return $ids;
  }

  /**
   * Activity ids of one kind on one side.
   *
   * @return array<int>
   *   Entity ids.
   */
  private function activitiesOnSide(string $side, string $kind): array {
    $ids = $this->container->get('entity_type.manager')
      ->getStorage('bb_activity')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $this->fixture($side, 'bb_ticket')->id())
      ->condition('kind', $kind)
      ->sort('id')
      ->execute();
    return array_map('intval', array_values($ids));
  }

  /**
   * Access-checked activity count as the given account.
   */
  private function queryCountAs(AccountInterface $account): int {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account);
    try {
      $count = $this->container->get('entity_type.manager')
        ->getStorage('bb_activity')
        ->getQuery()
        ->accessCheck(TRUE)
        ->count()
        ->execute();
    }
    finally {
      $switcher->switchBack();
    }
    return (int) $count;
  }

  /**
   * Query-access conditions for activities as the given account.
   */
  private function activityConditions(AccountInterface $account): ConditionGroup {
    $handler = $this->container->get('entity_type.manager')
      ->getHandler('bb_activity', 'query_access');
    self::assertInstanceOf(QueryAccessHandlerInterface::class, $handler);
    $conditions = $handler->getConditions('view', $account);
    self::assertInstanceOf(ConditionGroup::class, $conditions);
    return $conditions;
  }

  /**
   * Ticket ids named by a query-access group.
   *
   * @return array<int>
   *   Ticket ids.
   */
  private function ticketIdsFrom(ConditionGroup $group): array {
    $ids = [];
    foreach ($group->getConditions() as $condition) {
      if ($condition instanceof ConditionGroup) {
        $ids = array_merge($ids, $this->ticketIdsFrom($condition));
        continue;
      }
      if ($condition instanceof Condition && $condition->getField() === 'ticket_id') {
        $ids = array_merge($ids, array_map('intval', (array) $condition->getValue()));
      }
    }
    $ids = array_values(array_unique($ids));
    sort($ids);
    return $ids;
  }

  /**
   * Combined JSON:API AMONG_ALL filter access for activities.
   */
  private function filterAccess(AccountInterface $account): AccessResultInterface {
    $entity_type = $this->container->get('entity_type.manager')
      ->getDefinition('bb_activity');
    $combined = AccessResult::neutral();
    foreach ([
      'jsonapi_entity_filter_access',
      'jsonapi_bb_activity_filter_access',
    ] as $hook) {
      $this->container->get('module_handler')->invokeAllWith(
        $hook,
        function (callable $implementation) use (&$combined, $entity_type, $account): void {
          $results = $implementation($entity_type, $account);
          if (is_array($results) && isset($results[JsonApiFilter::AMONG_ALL])) {
            $combined = $combined->orIf($results[JsonApiFilter::AMONG_ALL]);
          }
        },
      );
    }
    return $combined;
  }

}
