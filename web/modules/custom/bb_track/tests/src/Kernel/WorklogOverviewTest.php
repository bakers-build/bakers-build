<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Entity\Worklog;
use Drupal\bb_track\Form\WorklogWeekForm;
use Drupal\bb_track\Form\WorklogWeekRowForm;
use Drupal\bb_track\Form\WorklogOverviewDestination;
use Drupal\bb_track\WorklogSelection;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;

/**
 * Personal day/week Worklog overview totals, paging and access.
 *
 * @SuppressWarnings("PHPMD.TooManyPublicMethods")
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogOverviewTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use TeamWorldTrait;
  use UserCreationTrait;
  use BillingAccountFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file',
    'image',
    'system',
    'user',
    'field',
    'options',
    'text',
    'link',
    'filter',
    'datetime',
    'entity',
    'state_machine',
    'og',
    'views',
    'island',
    'views_filters_summary',
    'ui_patterns',
    'display_builder',
    'ui_patterns_views',
    'display_builder_views',
    'bb_core',
    'bb_track',
    'bb_track_test',
  ];

  /**
   * Account that owns fixture groups so actors are not auto-membered.
   */
  private UserInterface $worldOwner;

  /**
   * Employee A.
   */
  private UserInterface $employee;

  /**
   * Employee B.
   */
  private UserInterface $peer;

  /**
   * Site administrator who does not own A's rows.
   */
  private UserInterface $admin;

  /**
   * Workspace under test.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * Permitted project P.
   */
  private BbProjectInterface $projectP;

  /**
   * Permitted project Q.
   */
  private BbProjectInterface $projectQ;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user',
      'file',
      'og_membership',
      'bb_workspace',
      'bb_group',
      'bb_team',
      'bb_project',
      'bb_ticket',
      'bb_track_submission', 'bb_track_account', 'bb_track_worklog',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('file', ['file_usage']);
    $this->installConfig(['system', 'user', 'filter', 'views']);
    $this->installOgScopeFixture();
    $this->installShippedView();
    $this->installMinimalMyWorkView();

    $permissions = [
      'record own worklog',
      'view bb_project',
      'view bb_ticket',
      'view bb_group',
    ];
    $this->createUser([], 'uid1-dummy');
    $world_owner = $this->createUser([], 'world-owner');
    $employee = $this->createUser($permissions, 'employee-a', FALSE, [
      'timezone' => 'Europe/Berlin',
    ]);
    $peer = $this->createUser($permissions, 'employee-b');
    $admin = $this->createUser(['administer bakers', 'access administration pages'], 'admin-peer');
    self::assertInstanceOf(UserInterface::class, $world_owner);
    self::assertInstanceOf(UserInterface::class, $employee);
    self::assertInstanceOf(UserInterface::class, $peer);
    self::assertInstanceOf(UserInterface::class, $admin);
    $this->worldOwner = $world_owner;
    $this->employee = $employee;
    $this->peer = $peer;
    $this->admin = $admin;

    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')->create([
      'name' => 'Workspace A',
      'slug' => 'workspace-a',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $group_p = $this->createGroup('Customer P');
    $group_q = $this->createGroup('Customer Q');
    $this->projectP = $this->createProject('PRJP', $group_p);
    $this->projectQ = $this->createProject('PRJQ', $group_q);
    $this->addMembership($this->workspace, $this->employee, ['lead']);
    $this->addMembership($this->workspace, $this->peer, ['lead']);
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * Tuesday/week totals ignore B and the following Monday.
   */
  public function testDayAndWeekTotalsIgnorePeerAndNextMonday(): void {
    $this->seedCanonicalWeek();
    $day = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-06',
    ]);
    self::assertSame(['2:30', 3], [$this->total($day), count($day->result)]);

    $day_p = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-06',
      'project' => (string) $this->projectP->id(),
    ]);
    self::assertSame('2:00', $this->total($day_p));
    self::assertCount(2, $day_p->result);

    $week = $this->overview($this->employee, [
      'mode' => 'week',
      'date' => '2026-10-06',
    ]);
    self::assertSame('4:30', $this->total($week));
    // Week mode shows the aggregate grid; it lists no rows.
    self::assertCount(0, $week->result);

    $week_p = $this->overview($this->employee, [
      'mode' => 'week',
      'date' => '2026-10-06',
      'project' => (string) $this->projectP->id(),
    ]);
    self::assertSame('4:00', $this->total($week_p));
    self::assertCount(0, $week_p->result);

    $monday = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-12',
    ]);
    self::assertSame('4:00', $this->total($monday));
    self::assertCount(1, $monday->result);
  }

  /**
   * Pagination does not change the unpaged total, including equal durations.
   */
  public function testPagerDoesNotChangeTotalAndEmptyWeekIsZero(): void {
    for ($i = 0; $i < 26; $i++) {
      $this->createRecorded($this->employee, [
        'work_date' => '2026-09-15',
        'duration_seconds' => 60,
        'description' => 'Minute ' . $i,
      ]);
    }
    $page1 = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-09-15',
    ], 0);
    $page2 = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-09-15',
    ], 1);
    self::assertCount(25, $page1->result);
    self::assertCount(1, $page2->result);
    self::assertSame('0:26', $this->total($page1));
    self::assertSame('0:26', $this->total($page2));

    $empty = $this->overview($this->employee, [
      'mode' => 'week',
      'date' => '2026-08-03',
    ]);
    self::assertCount(0, $empty->result);
    self::assertSame('0:00', $this->total($empty));
    $markup = $this->renderView($empty);
    self::assertStringContainsString('No time entries for this period.', $markup);
  }

  /**
   * Anonymous, peer and administrator never see A's rows or totals.
   */
  public function testForeignActorsCannotReadOwnerRowsOrTotals(): void {
    $this->seedCanonicalWeek();
    $query = [
      'mode' => 'day',
      'date' => '2026-10-06',
      'owner_user_id' => (string) $this->employee->id(),
    ];
    $peer = $this->overview($this->peer, $query);
    self::assertCount(1, $peer->result);
    $peer_row = $peer->result[0]->_entity;
    self::assertInstanceOf(Worklog::class, $peer_row);
    self::assertSame((string) $this->peer->id(), (string) $peer_row->getOwnerId());
    self::assertSame('9:00', $this->total($peer));

    $admin = $this->overview($this->admin, $query);
    self::assertCount(0, $admin->result);
    self::assertSame('0:00', $this->total($admin));

    $this->container->get('current_user')->setAccount(new AnonymousUserSession());
    $anonymous = $this->overview(NULL, $query);
    self::assertCount(0, $anonymous->result);
    self::assertSame('0:00', $this->total($anonymous));
  }

  /**
   * Invalid query values produce no rows rather than an unrestricted list.
   */
  public function testInvalidSelectionDoesNotBroaden(): void {
    $this->seedCanonicalWeek();
    foreach ([
      ['mode' => 'month', 'date' => '2026-10-06'],
      ['mode' => 'day', 'date' => '06-10-2026'],
      ['mode' => ['day'], 'date' => '2026-10-06'],
      ['mode' => 'day', 'date' => '2026-10-06', 'project' => '999999'],
      ['mode' => 'day', 'date' => '2026-10-06', 'project' => [(string) $this->projectP->id()]],
    ] as $query) {
      $view = $this->overview($this->employee, $query);
      self::assertCount(0, $view->result, print_r($query, TRUE));
      self::assertSame('0:00', $this->total($view), print_r($query, TRUE));
    }
  }

  /**
   * Deleted project hours leave the workspace list (no live workspace).
   */
  public function testDeletedProjectHoursLeaveTheWorkspaceOverview(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 4500,
      'description' => 'Gone project',
    ]);
    $this->projectP->delete();
    $view = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-06',
    ]);
    self::assertCount(0, $view->result);
    self::assertSame('0:00', $this->total($view));
  }

  /**
   * Hours on another workspace's project stay off this workspace's list.
   */
  public function testOtherWorkspaceHoursAreExcluded(): void {
    $other = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create([
        'name' => 'Workspace B',
        'slug' => 'workspace-b',
        'owner_user_id' => $this->worldOwner->id(),
      ]);
    $other->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $other);
    $foreign_group = $this->createGroup('Foreign customer', $other);
    $foreign_project = $this->createProject('PRJF', $foreign_group);
    $this->addMembership($other, $this->employee, ['lead']);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 3600,
      'project_id' => $foreign_project->id(),
      'description' => 'Other workspace hour',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 1800,
      'description' => 'Home workspace hour',
    ]);
    $view = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-06',
    ]);
    self::assertCount(1, $view->result);
    self::assertSame('0:30', $this->total($view));
    $markup = $this->renderView($view);
    self::assertStringContainsString('Home workspace hour', $markup);
    self::assertStringNotContainsString('Other workspace hour', $markup);
  }

  /**
   * The shipped view has one display per calendar context and no join.
   */
  public function testShippedViewHasFourCalendarContexts(): void {
    $view = Views::getView('worklog');
    self::assertInstanceOf(ViewExecutable::class, $view);
    $displays = $view->storage->get('display');
    $expected = [
      'page' => ['_workspace/%bb_workspace/time', 'workspace'],
      'personal' => ['user/%user/time', 'personal'],
      'team' => ['_workspace/%bb_workspace/team/%bb_team/time', 'team'],
      'project' => ['_workspace/%bb_workspace/project/%bb_project/time', 'project'],
    ];
    foreach ($expected as $id => [$path, $context]) {
      self::assertSame($path, $displays[$id]['display_options']['path']);
      $filters = $displays[$id]['display_options']['filters'] ?? $displays['default']['display_options']['filters'];
      self::assertSame($context, $filters['bb_worklog_period']['context']);
    }
    self::assertSame([], $displays['default']['display_options']['arguments'] ?? []);
    self::assertSame([], $displays['default']['display_options']['relationships'] ?? []);
  }

  /**
   * A team lead's own views stay owner-only after read access widens.
   */
  public function testLeadMyTimeStaysOwnerOnly(): void {
    $w = $this->createTeamWorld();
    $own = (int) $this->teamEntry('L', 'P1')->id();
    $this->teamEntry('M', 'P1');
    $page = $this->calendar('page', $w['L'], ['bb_workspace' => $w['W1']], ['mode' => 'day', 'date' => '2026-12-08']);
    self::assertSame([$own], $this->rowIds($page));
    $personal = $this->calendar('personal', $w['L'], ['user' => $w['L']], ['mode' => 'day', 'date' => '2026-12-08']);
    self::assertSame([$own], $this->rowIds($personal));
  }

  /**
   * The personal view spans workspaces and keeps a deleted project.
   */
  public function testPersonalViewSpansWorkspacesAndKeepsDeletedProject(): void {
    $w = $this->createTeamWorld();
    $p1 = (int) $this->teamEntry('M', 'P1')->id();
    $p2 = (int) $this->teamEntry('M', 'P2')->id();
    $gone_project = $this->createProject('GONE', $this->createGroup('Gone customer', $w['W1']));
    $gone = Worklog::create([
      'owner_user_id' => $w['M']->id(),
      'work_date' => '2026-12-08',
      'timezone' => 'UTC',
      'duration_seconds' => 600,
      'description' => 'Gone project work',
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $gone_project->id(),
    ]);
    LegacyWorklogFixture::save($gone);
    $gone_project->delete();

    $view = $this->calendar('personal', $w['M'], ['user' => $w['M']], ['mode' => 'day', 'date' => '2026-12-08']);
    $ids = $this->rowIds($view);
    sort($ids);
    self::assertSame([$p1, $p2, (int) $gone->id()], $ids);
    self::assertStringContainsString('Unresolved project', $this->renderDisplay($view, 'personal'));

    $other = $this->calendar('personal', $w['L'], ['user' => $w['M']], ['mode' => 'day', 'date' => '2026-12-08']);
    self::assertSame([], $this->rowIds($other));
  }

  /**
   * Forged person, project and ticket values invalidate the selection.
   */
  public function testForgedFiltersInvalidate(): void {
    $w = $this->createTeamWorld();
    $this->teamEntry('M', 'P1');
    $this->teamEntry('M2', 'P2');
    foreach ([
      ['person' => (string) $w['M2']->id()],
      ['person' => [(string) $w['M']->id()]],
      ['person' => '-1'],
      ['project' => (string) $w['P2']->id()],
      ['project' => (string) $w['P1']->id(), 'ticket' => '999'],
      ['ticket' => '1'],
    ] as $forged) {
      $query = ['mode' => 'day', 'date' => '2026-12-08'] + $forged;
      $view = $this->calendar('team', $w['L'], ['bb_workspace' => $w['W1'], 'bb_team' => $w['T1']], $query);
      self::assertSame([], $this->rowIds($view), print_r($forged, TRUE));
      $markup = $this->renderDisplay($view, 'team');
      self::assertStringContainsString('Total recorded time: 0:00', $markup, print_r($forged, TRUE));
    }
    $valid = $this->calendar('team', $w['L'], ['bb_workspace' => $w['W1'], 'bb_team' => $w['T1']], [
      'mode' => 'day',
      'date' => '2026-12-08',
      'person' => (string) $w['M']->id(),
    ]);
    self::assertCount(1, $valid->result);
  }

  /**
   * A project view narrows each viewer's authorized dataset.
   */
  public function testProjectDisplayShowsAuthorizedPeopleOnly(): void {
    $w = $this->createTeamWorld();
    $l = (int) $this->teamEntry('L', 'P1')->id();
    $m = (int) $this->teamEntry('M', 'P1')->id();
    $this->teamEntry('M', 'P2');
    $attributes = ['bb_workspace' => $w['W1'], 'bb_project' => $w['P1']];
    $query = ['mode' => 'day', 'date' => '2026-12-08'];
    $lead = $this->rowIds($this->calendar('project', $w['L'], $attributes, $query));
    sort($lead);
    self::assertSame([$l, $m], $lead);
    self::assertSame([$m], $this->rowIds($this->calendar('project', $w['M'], $attributes, $query)));
    $team = ['bb_workspace' => $w['W1'], 'bb_team' => $w['T1']];
    self::assertSame([], $this->rowIds($this->calendar('team', $w['M'], $team, $query)));
  }

  /**
   * Day totals cover every matching row, not one page, and skip peers.
   */
  public function testStripTotalsIgnorePagerAndPeers(): void {
    for ($i = 0; $i < 26; $i++) {
      $this->createRecorded($this->employee, [
        'work_date' => '2026-09-15',
        'duration_seconds' => 60,
        'description' => 'Minute ' . $i,
      ]);
    }
    $this->createRecorded($this->peer, ['work_date' => '2026-09-15', 'duration_seconds' => 3600]);
    $day = ['mode' => 'day', 'date' => '2026-09-15'];
    $selection = $this->selectionFor('workspace', $this->workspace, $this->employee, $day);
    $days = $this->container->get('bb_track.worklog_aggregates')->secondsByDay($selection);
    self::assertSame([
      '2026-09-14' => 0,
      '2026-09-15' => 1560,
      '2026-09-16' => 0,
      '2026-09-17' => 0,
      '2026-09-18' => 0,
      '2026-09-19' => 0,
      '2026-09-20' => 0,
    ], $days);
  }

  /**
   * Aggregates obey query access even without context conditions.
   */
  public function testAggregatesUseQueryAccess(): void {
    $w = $this->createTeamWorld();
    $this->teamEntry('M', 'P1', ['duration_seconds' => 600]);
    $this->teamEntry('L', 'P1', ['duration_seconds' => 1200]);
    $open = new WorklogSelection(
      TRUE,
      'project',
      'week',
      '2026-12-08',
      '2026-12-07',
      '2026-12-14',
      '2026-12-07',
      '2026-12-14',
      NULL,
      NULL,
      NULL,
      (int) $w['M']->id(),
      ['owners' => NULL, 'projects' => NULL],
      ['projects' => [], 'tickets' => [], 'people' => []],
    );
    $this->container->get('current_user')->setAccount($w['M']);
    $days = $this->container->get('bb_track.worklog_aggregates')->secondsByDay($open);
    self::assertSame(600, $days['2026-12-08']);
  }

  /**
   * A lead's team week grid has one row per person matching the strip.
   */
  public function testWeekGridByPersonForLead(): void {
    $w = $this->createTeamWorld();
    $this->teamEntry('M', 'P1', ['work_date' => '2026-12-08', 'duration_seconds' => 5400]);
    $this->teamEntry('M', 'P1', ['work_date' => '2026-12-10', 'duration_seconds' => 1800]);
    $this->teamEntry('L', 'P1', ['work_date' => '2026-12-09', 'duration_seconds' => 3600]);
    $this->teamEntry('M', 'P2', ['work_date' => '2026-12-08', 'duration_seconds' => 9999]);
    $this->teamEntry('M2', 'P2', ['work_date' => '2026-12-08', 'duration_seconds' => 9999]);
    $selection = $this->selectionFor('team', $w['T1'], $w['L'], ['mode' => 'day', 'date' => '2026-12-08']);
    $aggregates = $this->container->get('bb_track.worklog_aggregates');
    $grid = $aggregates->grid($selection, 'person');
    self::assertSame(['lead-l', 'member-m'], array_column($grid, 'label'));
    self::assertSame(['person' => (int) $w['M']->id()], $grid[1]['filter']);
    self::assertSame(5400, $grid[1]['days']['2026-12-08']);
    self::assertSame(1800, $grid[1]['days']['2026-12-10']);
    self::assertSame(7200, $grid[1]['total']);
    self::assertSame(3600, $grid[0]['total']);
    $days = $aggregates->secondsByDay($selection);
    self::assertSame(10800, array_sum($days));
    self::assertSame(array_sum(array_column($grid, 'total')), array_sum($days));
    $week = ['mode' => 'day', 'date' => '2026-12-08'];
    $projects = $aggregates->grid($this->selectionFor('workspace', $w['W1'], $w['M'], $week), 'project_ticket');
    self::assertSame(['Customer 1 · Project 1'], array_column($projects, 'label'));
    self::assertSame(['project' => (int) $w['P1']->id()], $projects[0]['filter']);
  }

  /**
   * An empty or invalid selection is seven zero days and no grid rows.
   */
  public function testEmptySelectionIsZero(): void {
    $aggregates = $this->container->get('bb_track.worklog_aggregates');
    foreach ([['mode' => 'week', 'date' => '2026-08-03'], ['mode' => 'month', 'date' => '2026-08-03']] as $query) {
      $selection = $this->selectionFor('workspace', $this->workspace, $this->employee, $query);
      $days = $aggregates->secondsByDay($selection);
      self::assertCount(7, $days);
      self::assertSame(0, array_sum($days));
      self::assertSame([], $aggregates->grid($selection, 'project_ticket'));
    }
  }

  /**
   * The personal calendar is owner-only; the team calendar is lead-only.
   */
  public function testCalendarRouteAccess(): void {
    $w = $this->createTeamWorld();
    $this->container->get('router.builder')->rebuild();
    $manager = $this->container->get('access_manager');
    $anonymous = new AnonymousUserSession();
    $personal = ['user' => $w['M']->id()];
    self::assertTrue($manager->checkNamedRoute('view.worklog.personal', $personal, $w['M']));
    self::assertFalse($manager->checkNamedRoute('view.worklog.personal', $personal, $w['L']));
    self::assertFalse($manager->checkNamedRoute('view.worklog.personal', $personal, $anonymous));
    $team = ['bb_workspace' => $w['W1']->getSlug(), 'bb_team' => $w['T1']->id()];
    self::assertTrue($manager->checkNamedRoute('view.worklog.team', $team, $w['L']));
    foreach (['M', 'WL', 'M2'] as $key) {
      self::assertFalse($manager->checkNamedRoute('view.worklog.team', $team, $w[$key]), $key);
    }
    self::assertFalse($manager->checkNamedRoute('view.worklog.team', $team, $anonymous));
    $project = ['bb_workspace' => $w['W1']->getSlug(), 'bb_project' => $w['P1']->id()];
    self::assertTrue($manager->checkNamedRoute('view.worklog.project', $project, $w['M']));
    self::assertFalse($manager->checkNamedRoute('view.worklog.project', $project, $anonymous));
  }

  /**
   * The form destination accepts the four calendars and nothing else.
   */
  public function testDestinationAcceptsTheFourCalendars(): void {
    $w = $this->createTeamWorld();
    $this->container->get('router.builder')->rebuild();
    $ws = $w['W1']->getSlug();
    $accepted = [
      '/' . $ws . '/time?mode=day&date=2026-12-08&project=' . $w['P1']->id(),
      '/user/' . $w['M']->id() . '/time?mode=week&date=2026-12-08',
      '/' . $ws . '/team/' . $w['T1']->id() . '/time?mode=day&date=2026-12-08&person=' . $w['M']->id(),
      '/' . $ws . '/project/' . $w['P1']->id() . '/time?mode=day&date=2026-12-08&ticket=7',
    ];
    foreach ($accepted as $destination) {
      $request = Request::create('/time/add', 'GET', ['destination' => $destination]);
      self::assertSame($destination, WorklogOverviewDestination::fromRequest($request), $destination);
    }
    foreach ([
      'https://example.com/' . $ws . '/time',
      '//example.com/' . $ws . '/time',
      '/' . $ws . '/projects',
      '/' . $ws . '/time?person=abc',
      '/' . $ws . '/time?mode=month',
    ] as $destination) {
      $request = Request::create('/time/add', 'GET', ['destination' => $destination]);
      self::assertNull(WorklogOverviewDestination::fromRequest($request), $destination);
    }
    $request = Request::create('/time/add', 'GET', ['destination' => '/' . $ws . '/time?mode=day&evil=1']);
    self::assertSame('/' . $ws . '/time?mode=day', WorklogOverviewDestination::fromRequest($request));
  }

  /**
   * DST, leap day and year-boundary weeks keep calendar allocation.
   */
  public function testCalendarBoundariesStayOnStoredDates(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-03-29',
      'duration_seconds' => 3600,
      'description' => 'DST spring',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-25',
      'duration_seconds' => 1800,
      'description' => 'DST autumn',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2028-02-29',
      'duration_seconds' => 7200,
      'description' => 'Leap day',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-12-28',
      'duration_seconds' => 600,
      'description' => 'Year start',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2027-01-03',
      'duration_seconds' => 1200,
      'description' => 'Year end',
    ]);

    $spring = $this->overview($this->employee, [
      'mode' => 'week',
      'date' => '2026-03-29',
    ]);
    self::assertSame('1:00', $this->total($spring));

    $autumn = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-25',
    ]);
    self::assertSame('0:30', $this->total($autumn));

    $leap = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2028-02-29',
    ]);
    self::assertSame('2:00', $this->total($leap));

    $year = $this->overview($this->employee, [
      'mode' => 'week',
      'date' => '2026-12-28',
    ]);
    self::assertSame('0:30', $this->total($year));
  }

  /**
   * Totals above 24 hours use exact minutes from large integer seconds.
   */
  public function testLargeDurationsDoNotTruncate(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 86400,
      'description' => 'Huge A',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 86400,
      'description' => 'Huge B',
    ]);
    $view = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-06',
    ]);
    self::assertSame('48:00', $this->total($view));
  }

  /**
   * Open carries a local overview destination that resets the page.
   */
  public function testOpenLinkCarriesOverviewDestination(): void {
    $entry = $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 3600,
      'description' => 'Open me',
    ]);
    $view = $this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-06',
      'project' => (string) $this->projectP->id(),
    ], 0);
    $markup = $this->renderView($view);
    $edit = Url::fromRoute('bb_track.worklog.edit', [
      'bb_track_worklog' => $entry->uuid(),
    ])->toString();
    self::assertStringContainsString($edit, $markup);
    self::assertStringContainsString('destination=', $markup);
    self::assertStringContainsString('workspace-a/time', $markup);
    self::assertStringContainsString('mode%3Dday', $markup);
    self::assertStringContainsString('data-hx-boost="false"', $markup);
  }

  /**
   * Proposed time has its own line and never reaches recorded totals.
   */
  public function testProposalsStayOutOfRecordedTotals(): void {
    $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 3600]);
    $this->proposedRow($this->employee, '2026-10-06', 7200);
    $markup = $this->renderView($this->overview($this->employee, ['mode' => 'week', 'date' => '2026-10-05']));
    self::assertSame('1:00', $this->total($this->overview($this->employee, ['mode' => 'week', 'date' => '2026-10-05'])));
    self::assertMatchesRegularExpression('/Proposed — not yet recorded:\s*2:00/', $markup);
    $day = $this->overview($this->employee, ['mode' => 'day', 'date' => '2026-10-06']);
    self::assertSame('0:00', $this->total($day));
  }

  /**
   * A team lead sees neither a member's proposed rows nor their hours.
   */
  public function testLeadNeverSeesProposedTime(): void {
    $w = $this->createTeamWorld();
    $this->teamEntry('M', 'P1', ['work_date' => '2026-12-08', 'duration_seconds' => 3600]);
    $proposed = $this->teamEntry('M', 'P1', ['work_date' => '2026-12-09', 'duration_seconds' => 7200]);
    \Drupal::database()->update('bb_track_worklog')->fields(['state' => 'proposed'])->condition('id', $proposed->id())->execute();
    $team = $this->calendar(
      'team',
      $w['L'],
      ['bb_team' => $w['T1'], 'bb_workspace' => $w['W1']],
      ['mode' => 'week', 'date' => '2026-12-08'],
    );
    $markup = $this->renderDisplay($team, 'team');
    self::assertMatchesRegularExpression('/Total recorded time:\s*1:00/', $markup);
    self::assertStringNotContainsString('Proposed', $markup);
    self::assertStringNotContainsString('bb-track-week-form', $markup);
  }

  /**
   * The week grid is a form only on the employee's own calendars.
   */
  public function testWeekGridIsEditableOnlyInPersonalContexts(): void {
    $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 3600]);
    $workspace = $this->renderView($this->overview($this->employee, ['mode' => 'week', 'date' => '2026-10-05']));
    self::assertStringContainsString('bb-track-week-form', $workspace);
    self::assertStringContainsString('name="cells[2026-10-05:' . $this->projectP->id() . ':0][duration]"', $workspace);
    self::assertStringContainsString('value="1:00"', $workspace);
    $personal = $this->calendar(
      'personal',
      $this->employee,
      ['user' => $this->employee],
      ['mode' => 'week', 'date' => '2026-10-05'],
    );
    self::assertStringContainsString('bb-track-week-form', $this->renderDisplay($personal, 'personal'));
    $foreign = $this->calendar(
      'personal',
      $this->peer,
      ['user' => $this->employee],
      ['mode' => 'week', 'date' => '2026-10-05'],
    );
    self::assertStringNotContainsString('bb-track-week-form', $this->renderDisplay($foreign, 'personal'));
  }

  /**
   * A cell with two entries is locked and links to its day.
   */
  public function testLockedCellHasNoInput(): void {
    $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 3600]);
    $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 600]);
    $markup = $this->renderView($this->overview($this->employee, ['mode' => 'week', 'date' => '2026-10-05']));
    self::assertStringNotContainsString('name="cells[2026-10-05:' . $this->projectP->id() . ':0][duration]"', $markup);
    self::assertStringContainsString('1:10 · 2 entries', $markup);
  }

  /**
   * Another employee's proposal in the address shows nothing at all.
   */
  public function testForeignSubmissionFilterShowsNothing(): void {
    $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 3600]);
    $foreign = $this->proposedRow($this->peer, '2026-10-06', 7200)->get('submission_id')->entity;
    $view = $this->overview($this->employee, [
      'mode' => 'week',
      'date' => '2026-10-05',
      'submission' => $foreign->uuid(),
    ]);
    self::assertSame('0:00', $this->total($view));
    self::assertStringNotContainsString('Proposed', $this->renderView($view));
  }

  /**
   * An own proposal opens the week of its earliest entry, limited to it.
   */
  public function testSubmissionOpensItsWeek(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-08-05',
      'duration_seconds' => 3600,
      'project_id' => $this->projectQ->id(),
    ]);
    $row = $this->proposedRow($this->employee, '2026-08-04', 7200);
    $uuid = $row->get('submission_id')->entity->uuid();
    $markup = $this->renderView($this->overview($this->employee, ['mode' => 'week', 'submission' => $uuid]));
    self::assertStringContainsString('Days of week 2026-08-03', $markup);
    self::assertStringContainsString('value="2:00"', $markup);
    // Rows of other projects stay out of the proposal's week.
    self::assertStringNotContainsString('value="1:00"', $markup);
    self::assertStringContainsString('AI proposal', $markup);
  }

  /**
   * The employee's day list shows their proposed entries with a badge.
   */
  public function testDayModeShowsOwnProposedRowWithBadge(): void {
    $this->proposedRow($this->employee, '2026-10-06', 7200);
    $day = $this->overview($this->employee, ['mode' => 'day', 'date' => '2026-10-06']);
    self::assertCount(1, $day->result);
    self::assertStringContainsString('Proposed', $this->renderView($day));
  }

  /**
   * Saving the grid writes every cell; an invalid cell writes nothing.
   */
  public function testWeekFormSavesAllOrNothing(): void {
    $kept = $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 3600]);
    $proposed = $this->proposedRow($this->employee, '2026-10-06', 7200);
    $p = (int) $this->projectP->id();
    $cells = [
      "2026-10-05:$p:0" => ['duration' => '1:30', 'entry' => (string) $kept->id(), 'version' => $kept->version()],
      "2026-10-06:$p:0" => [
        'duration' => '2:00',
        'entry' => (string) $proposed->id(),
        'version' => $proposed->version(),
      ],
      "2026-10-07:$p:0" => ['duration' => 'abc'],
    ];
    $state = $this->submitWeek($cells);
    self::assertSame(['2026-10-07:' . $p . ':0'], array_keys($state->get('cell_errors')));
    self::assertEquals(3600, Worklog::load($kept->id())->get('duration_seconds')->value);
    $cells["2026-10-07:$p:0"]['duration'] = '0:15';
    $state = $this->submitWeek($cells);
    self::assertSame([], $state->get('cell_errors') ?? []);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache();
    $reloaded_kept = Worklog::load($kept->id());
    $reloaded_proposed = Worklog::load($proposed->id());
    self::assertInstanceOf(Worklog::class, $reloaded_kept);
    self::assertInstanceOf(Worklog::class, $reloaded_proposed);
    $proposed_submission = $reloaded_proposed->get('submission_id')->entity;
    self::assertInstanceOf(Submission::class, $proposed_submission);
    self::assertEquals(5400, $reloaded_kept->get('duration_seconds')->value);
    self::assertSame('recorded', $reloaded_proposed->get('state')->value);
    self::assertSame('draft', $proposed_submission->get('state')->value);
    self::assertCount(3, $storage->loadByProperties(['owner_user_id' => $this->employee->id(), 'voided' => 0]));
  }

  /**
   * A filtered day offers Clear filters, which keeps the mode and date.
   */
  public function testFilteredDayOffersClearFilters(): void {
    $this->createRecorded($this->employee, ['work_date' => '2026-10-06', 'duration_seconds' => 3600]);
    $plain = $this->renderView($this->overview($this->employee, ['mode' => 'day', 'date' => '2026-10-06']));
    self::assertStringNotContainsString('Clear filters', $plain);
    $markup = $this->renderView($this->overview($this->employee, [
      'mode' => 'day',
      'date' => '2026-10-06',
      'project' => (string) $this->projectQ->id(),
    ]));
    self::assertMatchesRegularExpression('/href="[^"]*\\?mode=day&(amp;)?date=2026-10-06"[^>]*>\\s*(<[^>]+>\\s*)*Clear filters/', $markup);
  }

  /**
   * Save week books only the proposed cells the filtered grid showed.
   */
  public function testFilteredSaveLeavesHiddenProposalsProposed(): void {
    $shown = $this->proposedRow($this->employee, '2026-10-06', 7200);
    $hidden = $this->proposedRow($this->employee, '2026-10-07', 3600, $this->projectQ);
    $p = (int) $this->projectP->id();
    $state = $this->submitWeek([
      "2026-10-06:$p:0" => ['duration' => '2:00', 'entry' => (string) $shown->id(), 'version' => $shown->version()],
    ], ['project' => (string) $p]);
    self::assertSame([], $state->get('cell_errors') ?? []);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_track_worklog');
    $storage->resetCache();
    self::assertSame('recorded', Worklog::load($shown->id())->get('state')->value);
    self::assertSame('proposed', Worklog::load($hidden->id())->get('state')->value);
    $status = array_map('strval', $this->container->get('messenger')->messagesByType('status'));
    self::assertContains('Week saved: 1 change, 1 proposed entry recorded.', $status);
  }

  /**
   * A proposal's week shows the row's other stored days, so Save is not stale.
   */
  public function testProposalWeekShowsTheRowsOtherEntries(): void {
    $proposed = $this->proposedRow($this->employee, '2026-10-06', 7200);
    $manual = $this->createRecorded($this->employee, ['work_date' => '2026-10-07', 'duration_seconds' => 3600]);
    $uuid = $proposed->get('submission_id')->entity->uuid();
    $query = ['mode' => 'week', 'date' => '2026-10-05', 'submission' => $uuid];
    $this->overview($this->employee, $query);
    $state = new FormState();
    $state->addBuildInfo('args', [$this->selectionFor('workspace', $this->workspace, $this->employee, $query)]);
    $form = $this->container->get('form_builder')->buildForm(WorklogWeekForm::class, $state);
    $p = (int) $this->projectP->id();
    $cell = $this->sheetCell($form, "2026-10-07:$p:0");
    self::assertSame('1:00', $cell['value']);
    self::assertSame((string) $manual->id(), $cell['hidden']["cells[2026-10-07:$p:0][entry]"]);
  }

  /**
   * A refused stale cell keeps the posted version, so a retry fails again.
   */
  public function testStaleCellKeepsPostedVersion(): void {
    $row = $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 3600]);
    $key = '2026-10-05:' . $this->projectP->id() . ':0';
    $state = new FormState();
    $state->set('cell_errors', [$key => 'This entry changed. Reload the week.']);
    $posted = ['duration' => '2:00', 'entry' => (string) $row->id(), 'version' => 'posted-version'];
    $state->setUserInput(['cells' => [$key => $posted]]);
    $state->addBuildInfo('args', [$this->weekSelection()]);
    $form = $this->container->get('form_builder')->buildForm(WorklogWeekForm::class, $state);
    $cell = $this->sheetCell($form, $key);
    self::assertSame('posted-version', $cell['hidden']["cells[$key][version]"]);
    self::assertSame('2:00', $cell['value']);
    self::assertSame('This entry changed. Reload the week.', $cell['error']);
  }

  /**
   * A cell's Details opens the shared form in the dialog over the week.
   */
  public function testCellDetailsOpenInTheDialog(): void {
    $row = $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 3600]);
    $cell = $this->sheetCell($this->weekForm(), '2026-10-05:' . $this->projectP->id() . ':0');
    self::assertStringContainsString('/time/' . $row->uuid() . '/edit?destination=', $cell['url']);
    self::assertStringContainsString('_wrapper_format=island_dialog', $cell['hx']['get']);
    self::assertStringContainsString('destination=', $cell['hx']['get']);
    self::assertSame('#bakers-overlay', $cell['hx']['target']);
    self::assertSame('dialog:not(dialog dialog)', $cell['hx']['select']);
  }

  /**
   * Grid cells name the totals their typed value moves before Save.
   */
  public function testGridCarriesLiveSumKeys(): void {
    $this->createRecorded($this->employee, ['work_date' => '2026-10-05', 'duration_seconds' => 3600]);
    $this->proposedRow($this->employee, '2026-10-06', 7200);
    $p = (int) $this->projectP->id();
    $form = $this->weekForm();
    self::assertTrue($form['sheet']['#props']['live_sums']);
    $recorded = $this->sheetCell($form, "2026-10-05:$p:0");
    self::assertSame(["row:$p:0"], $recorded['sums']);
    self::assertSame(3600, $recorded['stored']);
    $proposed = $this->sheetCell($form, "2026-10-06:$p:0");
    self::assertSame(["row:$p:0", 'proposed:2026-10-06', 'proposed:total'], $proposed['sums']);
    self::assertSame(7200, $proposed['stored']);
    self::assertSame(0, $this->sheetCell($form, "2026-10-07:$p:0")['stored']);
    $rows = $form['sheet']['#props']['rows'];
    $grid_row = current(array_filter($rows, static fn (array $row): bool => ($row['cells']['2026-10-05']['name'] ?? '') === "cells[2026-10-05:$p:0][duration]"));
    self::assertSame("row:$p:0", $grid_row['cells']['total']['sum']);
    self::assertSame(10800, $grid_row['cells']['total']['seconds']);
    $line = current(array_filter($rows, static fn (array $row): bool => $row['cells']['label']['value'] === 'Proposed — not yet recorded'));
    self::assertSame('proposed:2026-10-06', $line['cells']['2026-10-06']['sum']);
    self::assertSame(7200, $line['cells']['2026-10-06']['seconds']);
    self::assertSame('proposed:total', $line['cells']['total']['sum']);
  }

  /**
   * Add row opens a dialog; the row it chose appears as empty grid cells.
   */
  public function testAddRowOpensDialogAndShowsChosenRow(): void {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'title' => 'Grid ticket',
      'project_id' => $this->projectP->id(),
      'workflow' => 'bb_work',
    ]);
    $ticket->save();
    $form = $this->weekForm();
    self::assertStringContainsString('/time/week/row?destination=', $form['add_row']['#props']['href']);
    self::assertStringContainsString('_wrapper_format=island_dialog', (string) $form['add_row']['#props']['attributes']);
    $key = '2026-10-07:' . $this->projectP->id() . ':' . $ticket->id();
    $markup = $this->renderView($this->overview($this->employee, [
      'mode' => 'week',
      'date' => '2026-10-05',
      'rows' => $this->projectP->id() . ':' . $ticket->id(),
    ]));
    self::assertStringContainsString('name="cells[' . $key . '][duration]"', $markup);
    $forged = $this->renderView($this->overview($this->employee, [
      'mode' => 'week',
      'date' => '2026-10-05',
      'rows' => $this->projectQ->id() . ':' . $ticket->id(),
    ]));
    self::assertStringNotContainsString(':' . $ticket->id() . '][duration]"', $forged);
  }

  /**
   * The Add row dialog returns to the week with the chosen row.
   */
  public function testAddRowFormReturnsWithTheChosenRow(): void {
    $p = (string) $this->projectP->id();
    $destination = '/workspace-a/time?mode=week&date=2026-10-05';
    $this->container->get('current_user')->setAccount($this->employee);
    $request = Request::create('/time/week/row?' . http_build_query(['destination' => $destination]), 'POST');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    $state = new FormState();
    $state->setValues(['project' => [$p], 'ticket' => [], 'op' => 'Add row']);
    $this->container->get('form_builder')->submitForm(WorklogWeekRowForm::class, $state);
    self::assertSame([], $state->getErrors());
    // Core redirects to `destination`, so the chosen row is carried there.
    self::assertSame($destination . '&rows=' . $p . '%3A0', $request->query->get('destination'));
    $forbidden = new FormState();
    $forbidden->setValues(['project' => [(string) $this->projectQ->id() . '9'], 'ticket' => [], 'op' => 'Add row']);
    $this->container->get('form_builder')->submitForm(WorklogWeekRowForm::class, $forbidden);
    self::assertNotSame([], $forbidden->getErrors());
  }

  /**
   * The built week form of the employee's week of 2026-10-05.
   *
   * @return array<string, mixed>
   *   The form.
   */
  private function weekForm(): array {
    $state = new FormState();
    $state->addBuildInfo('args', [$this->weekSelection()]);
    $form = $this->container->get('form_builder')->buildForm(WorklogWeekForm::class, $state);
    self::assertSame('off', $form['#attributes']['autocomplete'] ?? NULL);
    return $form;
  }

  /**
   * The employee's own week of 2026-10-05.
   */
  private function weekSelection(): WorklogSelection {
    $this->overview($this->employee, ['mode' => 'week', 'date' => '2026-10-05']);
    $query = ['mode' => 'week', 'date' => '2026-10-05'];
    return $this->selectionFor('workspace', $this->workspace, $this->employee, $query);
  }

  /**
   * One cell of the built week grid.
   *
   * @param array<string, mixed> $form
   *   The built week form.
   * @param string $key
   *   The cell key.
   *
   * @return array<string, mixed>
   *   The cell.
   */
  private function sheetCell(array $form, string $key): array {
    $date = explode(':', $key)[0];
    foreach ($form['sheet']['#props']['rows'] as $row) {
      if (($row['cells'][$date]['name'] ?? '') === "cells[$key][duration]") {
        return $row['cells'][$date];
      }
    }
    self::fail("No grid cell $key.");
  }

  /**
   * Submits the employee's week form for the week of 2026-10-05.
   *
   * @param array<string, array<string, string>> $cells
   *   Submitted cells.
   * @param array<string, string> $filters
   *   Extra calendar query, such as a project filter.
   */
  private function submitWeek(array $cells, array $filters = []): FormStateInterface {
    $query = ['mode' => 'week', 'date' => '2026-10-05'] + $filters;
    $this->overview($this->employee, $query);
    $selection = $this->selectionFor('workspace', $this->workspace, $this->employee, $query);
    $state = new FormState();
    $state->setValues(['cells' => $cells, 'op' => 'Save week']);
    $this->container->get('form_builder')->submitForm(WorklogWeekForm::class, $state, $selection);
    return $state;
  }

  /**
   * A proposed row of an owner in a fresh proposal.
   */
  private function proposedRow(UserInterface $owner, string $date, int $seconds, ?BbProjectInterface $project = NULL): Worklog {
    $current = $this->container->get('current_user')->getAccount();
    $this->container->get('current_user')->setAccount($owner);
    $proposal = Submission::create(['state' => 'proposed']);
    $proposal->save();
    $row = $this->container->get('bb_track.activity_input')->input([
      'source_system' => 'test',
      'source_key' => 'proposal-' . $owner->id() . '-' . $date,
      'source_version' => '1',
      'work_date' => $date,
      'description' => 'Proposed work',
      'project_id' => (int) ($project ?? $this->projectP)->id(),
      'duration_seconds' => $seconds,
      'submission_id' => (int) $proposal->id(),
    ]);
    $this->container->get('current_user')->setAccount($current);
    return $row;
  }

  /**
   * Seeds the plan's canonical A/B week.
   */
  private function seedCanonicalWeek(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 4500,
      'description' => 'A P 1:15',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 2700,
      'description' => 'A P 0:45',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 1800,
      'project_id' => $this->projectQ->id(),
      'description' => 'A Q 0:30',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-11',
      'duration_seconds' => 7200,
      'description' => 'A P Sunday 2:00',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-12',
      'duration_seconds' => 14400,
      'description' => 'A P Monday 4:00',
    ]);
    $this->createRecorded($this->peer, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 32400,
      'description' => 'B P 9:00',
    ]);
  }

  /**
   * Executes the shipped overview as an actor.
   *
   * @param \Drupal\user\UserInterface|null $account
   *   Acting account, or NULL to keep the current user.
   * @param array<string, mixed> $query
   *   Address query.
   * @param int $page
   *   Zero-based page.
   */
  private function overview(?UserInterface $account, array $query, int $page = 0): ViewExecutable {
    return $this->calendar('page', $account, ['bb_workspace' => $this->workspace], $query, $page);
  }

  /**
   * Executes one calendar display with route attributes as an actor.
   *
   * @param string $display
   *   Display id.
   * @param \Drupal\user\UserInterface|null $account
   *   Acting account, or NULL to keep the current user.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $attributes
   *   Route attributes, e.g. bb_workspace, bb_team, bb_project, user.
   * @param array<string, mixed> $query
   *   Address query.
   * @param int $page
   *   Zero-based page.
   */
  private function calendar(string $display, ?UserInterface $account, array $attributes, array $query, int $page = 0): ViewExecutable {
    if ($account instanceof UserInterface) {
      $this->container->get('current_user')->setAccount($account);
    }
    $query['page'] = (string) $page;
    $request = Request::create('/time', 'GET', $query);
    foreach ($attributes as $key => $entity) {
      $request->attributes->set($key, $entity);
    }
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    else {
      $request->setSession(new Session(new MockArraySessionStorage()));
    }
    $this->container->get('request_stack')->push($request);
    $view = Views::getView('worklog');
    self::assertInstanceOf(ViewExecutable::class, $view);
    self::assertTrue($view->setDisplay($display));
    $view->setExposedInput($query);
    $view->setCurrentPage($page);
    $view->get_total_rows = TRUE;
    $view->preExecute();
    $view->execute($display);
    return $view;
  }

  /**
   * Resolves a calendar selection as an actor.
   *
   * @param string $context
   *   Calendar context.
   * @param \Drupal\Core\Entity\EntityInterface $subject
   *   Context subject.
   * @param \Drupal\user\UserInterface $account
   *   Viewer.
   * @param array<string, string> $query
   *   Address query.
   */
  private function selectionFor(string $context, EntityInterface $subject, UserInterface $account, array $query): WorklogSelection {
    $this->container->get('current_user')->setAccount($account);
    return $this->container->get('bb_track.worklog_calendar')->selection($context, $subject, $account, $query);
  }

  /**
   * Row entity ids of an executed view.
   *
   * @return list<int>
   *   Ids in result order.
   */
  private function rowIds(ViewExecutable $view): array {
    return array_values(array_map(static fn ($row): int => (int) $row->_entity->id(), $view->result));
  }

  /**
   * Renders an executed display.
   */
  private function renderDisplay(ViewExecutable $view, string $display): string {
    $build = $view->render($display);
    self::assertIsArray($build);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Reads the formatted total from the executed view.
   */
  private function total(ViewExecutable $view): string {
    $markup = $this->renderView($view);
    self::assertSame(1, preg_match('/Total recorded time:\s*(\d+:\d{2})/', $markup, $matches));
    self::assertArrayHasKey(1, $matches);
    return $matches[1];
  }

  /**
   * Renders an executed view.
   */
  private function renderView(ViewExecutable $view): string {
    $build = $view->render('page');
    self::assertIsArray($build);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Creates a recorded row.
   *
   * @param \Drupal\user\UserInterface $owner
   *   Row owner.
   * @param array<string, mixed> $values
   *   Field overrides.
   */
  private function createRecorded(UserInterface $owner, array $values = []): Worklog {
    $entry = Worklog::create([
      'owner_user_id' => $owner->id(),
      'work_date' => $values['work_date'] ?? '2026-10-06',
      'timezone' => $values['timezone'] ?? 'UTC',
      'duration_seconds' => $values['duration_seconds'] ?? 5400,
      'description' => $values['description'] ?? 'Review changes',
      'derivation' => 'manual',
      'state' => $values['state'] ?? 'recorded',
      'project_id' => $values['project_id'] ?? $this->projectP->id(),
      'ticket_id' => $values['ticket_id'] ?? NULL,
    ]);
    LegacyWorklogFixture::save($entry);
    self::assertInstanceOf(Worklog::class, $entry);
    return $entry;
  }

  /**
   * Creates a group in a workspace.
   */
  private function createGroup(string $name, ?BbWorkspaceInterface $workspace = NULL): BbGroupInterface {
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create([
        'name' => $name,
        'workspace_id' => ($workspace ?? $this->workspace)->id(),
        'owner_user_id' => $this->worldOwner->id(),
      ]);
    $group->save();
    self::assertInstanceOf(BbGroupInterface::class, $group);
    return $group;
  }

  /**
   * Creates a project in a group.
   */
  private function createProject(string $key, BbGroupInterface $group): BbProjectInterface {
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => $key,
        'key' => $key,
        'owner_user_id' => $this->worldOwner->id(),
        'group_id' => $group->id(),
      ]);
    $project->save();
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->attachBillingAccount($project);
    return $project;
  }

  /**
   * Loads the shipped overview View.
   */
  private function installShippedView(): void {
    $path = dirname(__DIR__, 7) . '/recipes/bakers/config/views.view.worklog.yml';
    self::assertFileExists($path);
    $data = Yaml::parseFile($path);
    self::assertIsArray($data);
    $this->container->get('entity_type.manager')->getStorage('view')->create($data)->save();
  }

  /**
   * Registers the My work page so local tasks resolve.
   */
  private function installMinimalMyWorkView(): void {
    $this->container->get('entity_type.manager')->getStorage('view')->create([
      'id' => 'tickets',
      'base_table' => 'users_field_data',
      'display' => [
        'default' => [
          'display_plugin' => 'default',
          'id' => 'default',
          'display_title' => 'Default',
          'position' => 0,
          'display_options' => [],
        ],
        'my_work' => [
          'display_plugin' => 'page',
          'id' => 'my_work',
          'display_title' => 'My work',
          'position' => 1,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/tickets',
          ],
        ],
      ],
    ])->save();
  }

}
