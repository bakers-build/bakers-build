<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Statistics\Period\PeriodRange;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Statistics\BillingReport;
use Drupal\bb_track\WorkAssignments;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * What the billing report counts, and where it counts it.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class BillingReportTest extends WorkTimeTestBase {

  use BillingAccountFixtureTrait;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['bb_conductor', 'bb_comment', 'bb_run', 'bb_term'] as $type) {
      $this->installEntitySchema($type);
    }
  }

  /**
   * Proposed and voided time adds nothing.
   */
  public function testOnlyRecordedAndApprovedUnvoidedHoursCount(): void {
    $this->worklog(3600);
    $this->worklog(7200, ['state' => 'approved']);
    $this->worklog(14400, ['state' => 'proposed']);
    $this->worklog(28800, ['state' => 'approved', 'voided' => TRUE]);
    $account = $this->find($this->report(), 'a' . $this->accountId);
    self::assertSame([10800, 7200, 3600], [$account['hours'], $account['approved'], $account['recorded']]);
  }

  /**
   * Hours count on the account the worklog was booked on.
   */
  public function testHoursStayOnTheWorklogsOwnAccount(): void {
    $ticket = $this->ticket('Linked');
    $linked = $this->account('Linked account', $ticket);
    $booked = $this->account('Booked account');
    $this->worklog(3600, ['ticket_id' => $ticket->id(), 'account_id' => $booked->id()]);
    $nodes = $this->report();
    self::assertSame(3600, $this->find($nodes, 'a' . $booked->id())['hours']);
    self::assertNull($this->find($nodes, 'a' . $linked->id()));
  }

  /**
   * Tokens count on the ticket's linked account, else the project default.
   */
  public function testTokensFollowTheTicketsResolvedAccount(): void {
    $linked = $this->ticket('Linked');
    $plain = $this->ticket('Plain');
    $account = $this->account('Linked account', $linked);
    $this->createRun($linked, 100);
    $this->createRun($plain, 50);
    $nodes = $this->report();
    self::assertSame(100, $this->find($nodes, 'a' . $account->id())['tokens']);
    self::assertSame(50, $this->find($nodes, 'a' . $this->accountId)['tokens']);
  }

  /**
   * Tokens on a project without any active account form their own group.
   */
  public function testTokensWithoutAccountGoToNoBillingAccount(): void {
    $project = $this->project('Orphan', 'ORPH');
    $this->archiveAccounts($project);
    $this->createRun($this->ticket('Lost', NULL, $project), 500);
    $this->createRun($this->ticket('Billed'), 20);
    $nodes = $this->report();
    $none = $this->find($nodes, 'n');
    self::assertSame(['none', 500], [$none['kind'], $none['tokens']]);
    self::assertSame(520, array_sum(array_column($nodes, 'tokens')));
  }

  /**
   * Every parent's hours and tokens are the sum of its children's.
   */
  public function testParentsSumTheirChildren(): void {
    $this->seedMixedData();
    foreach (['account', 'person'] as $group) {
      $nodes = $this->report([], $group);
      self::assertNotEmpty($nodes);
      $this->assertSums($nodes);
    }
  }

  /**
   * The first and last day count; the day after does not.
   */
  public function testPeriodBoundsAreInclusive(): void {
    $ticket = $this->ticket('Edge');
    $period = $this->period();
    $this->worklog(3600, ['work_date' => $period->start]);
    $this->worklog(7200, ['work_date' => $period->end]);
    $this->worklog(14400, ['work_date' => '2026-09-01']);
    $this->worklog(28800, ['work_date' => '2026-07-31']);
    $this->createRun($ticket, 1, $period->from());
    $this->createRun($ticket, 2, $period->to());
    $this->createRun($ticket, 4, $period->to() + 1);
    $this->createRun($ticket, 8, $period->from() - 1);
    $account = $this->find($this->report(), 'a' . $this->accountId);
    self::assertSame([10800, 3], [$account['hours'], $account['tokens']]);
  }

  /**
   * By person: owner's hours, assignee's tokens, unassigned tokens apart.
   */
  public function testGroupByPersonNestsAccountProjectTicket(): void {
    $this->worklog(3600);
    $this->createRun($this->ticket('Peer work', $this->peer), 70);
    $this->createRun($this->ticket('Nobody'), 30);
    $nodes = $this->report([], 'person');
    $keys = array_column($nodes, 'key');
    sort($keys);
    $expected = ['u' . $this->employee->id(), 'u' . $this->peer->id(), 'u0'];
    sort($expected);
    self::assertSame($expected, $keys);
    $peer = $this->find($nodes, 'u' . $this->peer->id());
    self::assertSame(70, $peer['tokens']);
    $account = $peer['children'][0];
    self::assertSame(['account', 'u' . $this->peer->id() . '.a' . $this->accountId], [$account['kind'], $account['key']]);
    self::assertSame('project', $account['children'][0]['kind']);
    self::assertSame('ticket', $account['children'][0]['children'][0]['kind']);
    self::assertSame(30, $this->find($nodes, 'u0')['tokens']);
    $byAccount = $this->report();
    self::assertSame(array_sum(array_column($byAccount, 'hours')), array_sum(array_column($nodes, 'hours')));
    self::assertSame(array_sum(array_column($byAccount, 'tokens')), array_sum(array_column($nodes, 'tokens')));
  }

  /**
   * Time recorded on the project alone gets a row of its own.
   */
  public function testWorklogWithoutTicketGetsItsOwnRow(): void {
    $this->worklog(3600);
    $project = $this->find($this->report(), 'a' . $this->accountId)['children'][0];
    $row = $project['children'][0];
    self::assertSame(
      ['no_ticket', 'w' . $this->project->id(), 'Without ticket', 3600],
      [$row['kind'], $row['key'], $row['label'], $row['hours']],
    );
  }

  /**
   * Another workspace's worklogs and runs never show up.
   */
  public function testOtherWorkspaceIsExcluded(): void {
    $types = $this->container->get('entity_type.manager');
    $south = $types->getStorage('bb_workspace')->create(['name' => 'South', 'slug' => 'south']);
    $south->save();
    $group = $types->getStorage('bb_group')->create(['name' => 'South group', 'workspace_id' => $south->id()]);
    $group->save();
    $foreign = $this->project('South shop', 'SOUTH', (int) $group->id());
    $account = $this->assignments()->defaultAccount((int) $foreign->id());
    $this->worklog(3600, ['project_id' => $foreign->id(), 'account_id' => $account?->id()]);
    $this->createRun($this->ticket('South ticket', NULL, $foreign), 40);
    self::assertSame([], $this->report());
  }

  /**
   * Filters narrow hours and tokens alike; an account filter drops "none".
   */
  public function testFiltersNarrowHoursAndTokensAndHideNoAccount(): void {
    $this->seedMixedData();
    $nodes = $this->report(['account' => [$this->accountId]]);
    self::assertSame(['a' . $this->accountId], array_column($nodes, 'key'));
    self::assertGreaterThan(0, $nodes[0]['hours']);
    self::assertGreaterThan(0, $nodes[0]['tokens']);
    $nodes = $this->report(['project' => [(int) $this->project->id()]]);
    self::assertNotContains('n', array_column($nodes, 'key'));
    foreach ($nodes as $account) {
      self::assertSame([(int) $this->project->id()], array_map(static fn(array $project): int => (int) $project['entity']->id(), $account['children']));
    }
  }

  /**
   * A period without billable time or tokens has no rows.
   */
  public function testEmptyPeriodReturnsNoNodes(): void {
    $this->worklog(3600, ['state' => 'proposed']);
    self::assertSame([], $this->report());
  }

  /**
   * Hours and tokens on two accounts, an orphan project and two people.
   */
  private function seedMixedData(): void {
    $linked = $this->ticket('Linked', $this->peer);
    $this->account('Linked account', $linked);
    $plain = $this->ticket('Plain');
    $this->worklog(3600, ['ticket_id' => $linked->id()]);
    $this->worklog(5400, ['ticket_id' => $plain->id(), 'state' => 'approved']);
    $this->worklog(1800);
    $this->createRun($linked, 300);
    $this->createRun($plain, 200);
    $orphan = $this->project('Orphan', 'ORPH');
    $this->archiveAccounts($orphan);
    $this->createRun($this->ticket('Lost', $this->employee, $orphan), 100);
  }

  /**
   * Asserts every node's sums equal its children's, recursively.
   *
   * @param list<array<string, mixed>> $nodes
   *   Nodes.
   */
  private function assertSums(array $nodes): void {
    foreach ($nodes as $node) {
      if ($node['children'] === []) {
        continue;
      }
      foreach (['hours', 'approved', 'recorded', 'tokens'] as $sum) {
        self::assertSame($node[$sum], array_sum(array_column($node['children'], $sum)), $node['key'] . ' ' . $sum);
      }
      $this->assertSums($node['children']);
    }
  }

  /**
   * The report of the fixture workspace for August 2026.
   *
   * @param array<string, list<int>> $filters
   *   Account and project ids.
   * @param string $group
   *   Either `account` or `person`.
   *
   * @return list<array<string, mixed>>
   *   The top-level nodes.
   */
  private function report(array $filters = [], string $group = 'account'): array {
    $report = $this->container->get('bb_track.billing_report');
    assert($report instanceof BillingReport);
    $workspace = $this->fixtureWorkspace();
    return $report->build($workspace, $this->period(), $filters, $group);
  }

  /**
   * August 2026.
   */
  private function period(): PeriodRange {
    return new PeriodRange('custom', '2026-08-01', '2026-08-31', 'August 2026', 'day', FALSE);
  }

  /**
   * The node with this key among the nodes, or NULL.
   *
   * @param list<array<string, mixed>> $nodes
   *   Nodes.
   * @param string $key
   *   The node key.
   *
   * @return array<string, mixed>|null
   *   The node.
   */
  private function find(array $nodes, string $key): ?array {
    return array_column($nodes, NULL, 'key')[$key] ?? NULL;
  }

  /**
   * Saves a worklog of the employee on the fixture project in August.
   *
   * @param int $seconds
   *   The duration.
   * @param array<string, mixed> $values
   *   Overrides; `state` and `voided` are written after the save, as
   *   historical rows carry them.
   */
  private function worklog(int $seconds, array $values = []): void {
    $entry = Worklog::create(array_filter([
      'owner_user_id' => $this->employee->id(),
      'work_date' => $values['work_date'] ?? '2026-08-10',
      'timezone' => 'UTC',
      'duration_seconds' => $seconds,
      'description' => 'Work',
      'derivation' => 'manual',
      'state' => $values['state'] ?? 'recorded',
      'project_id' => $values['project_id'] ?? $this->project->id(),
      'ticket_id' => $values['ticket_id'] ?? NULL,
      'account_id' => $values['account_id'] ?? NULL,
    ], static fn($value): bool => $value !== NULL));
    assert($entry instanceof Worklog);
    LegacyWorklogFixture::save($entry);
    if (!empty($values['voided'])) {
      $this->container->get('database')->update('bb_track_worklog')
        ->fields(['voided' => 1])->condition('id', $entry->id())->execute();
    }
  }

  /**
   * Saves a run with tokens on a ticket, mid-August by default.
   */
  private function createRun(ContentEntityInterface $ticket, int $tokens, ?int $created = NULL): void {
    $this->container->get('entity_type.manager')->getStorage('bb_run')->create([
      'ticket_id' => $ticket->id(),
      'state' => 'running',
      'state_at_start' => 'working',
      'created' => $created ?? $this->period()->from() + 10 * 86400,
      'tokens' => $tokens,
    ])->save();
  }

  /**
   * Saves a ticket, on the fixture project unless another is given.
   */
  private function ticket(string $title, ?UserInterface $assignee = NULL, ?BbProjectInterface $project = NULL): ContentEntityInterface {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => $title,
      'project_id' => ($project ?? $this->project)->id(),
      'workflow' => 'bb_work',
      'assignee_user_id' => $assignee?->id(),
    ]);
    $ticket->save();
    assert($ticket instanceof ContentEntityInterface);
    return $ticket;
  }

  /**
   * Saves a project in the fixture workspace unless a group is given.
   */
  private function project(string $name, string $key, ?int $group = NULL): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')->getStorage('bb_project')->create([
      'name' => $name,
      'key' => $key,
      'group_id' => $group ?? $this->project->get('group_id')->target_id,
    ]);
    assert($project instanceof BbProjectInterface);
    $project->save();
    return $project;
  }

  /**
   * A new active account of the fixture project, linking the ticket if any.
   */
  private function account(string $name, ?ContentEntityInterface $ticket = NULL): Account {
    $account = $this->assignments()->saveAccount((int) $this->project->id(), ['name' => $name]);
    if ($ticket !== NULL) {
      $this->assignments()->linkTicket((int) $ticket->id(), (int) $account->id(), 0);
    }
    return $account;
  }

  /**
   * The assignments service.
   */
  private function assignments(): WorkAssignments {
    $assignments = $this->container->get('bb_track.assignments');
    assert($assignments instanceof WorkAssignments);
    return $assignments;
  }

}
