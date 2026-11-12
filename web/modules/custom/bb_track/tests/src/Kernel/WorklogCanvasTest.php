<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_track\Kernel;

use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_track\Entity\Worklog;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\OgScopeFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;

/**
 * My time uses the ticket-list canvas: a toolbar above the rows, summary chips, no search.
 */
#[Group('bb_track')]
#[RunTestsInSeparateProcesses]
final class WorklogCanvasTest extends KernelTestBase {

  use OgScopeFixtureTrait;
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
    'filter',
    'link',
    'datetime',
    'entity',
    'state_machine',
    'og',
    'views',
    'island',
    'views_filters_summary',
    'ui_patterns',
    'ui_patterns_views',
    'display_builder',
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
   * Employee who owns the listed hours.
   */
  private UserInterface $employee;

  /**
   * Workspace under test.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * Permitted project.
   */
  private BbProjectInterface $project;

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
    $this->enableTheShippedDisplayExtender();
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'display_builder']);
    $this->installShippedView();

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
    self::assertInstanceOf(UserInterface::class, $world_owner);
    self::assertInstanceOf(UserInterface::class, $employee);
    $this->worldOwner = $world_owner;
    $this->employee = $employee;

    $storage = $this->container->get('entity_type.manager');
    $workspace = $storage->getStorage('bb_workspace')->create([
      'name' => 'Workspace A',
      'slug' => 'workspace-a',
      'owner_user_id' => $this->worldOwner->id(),
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;

    $group = $this->createGroup('Customer P');
    $this->project = $this->createProject('PRJP', $group);
    $this->addMembership($this->workspace, $this->employee, ['lead']);
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
  }

  /**
   * The overview is one canvas, not the bare Views stack.
   */
  public function testTheViewRendersAsTheCanvas(): void {
    $html = $this->screen(['mode' => 'week', 'date' => '2026-10-06']);

    self::assertStringContainsString(
      'data-component-id="bb_theme:canvas"',
      $html,
      'The display builder tree did not reach the view; this is the bare Views output.',
    );
    self::assertStringNotContainsString('data-canvas-region="filters"', $html, 'The controls left the rail for the toolbar.');
    self::assertStringContainsString('data-canvas-region="main"', $html);
  }

  /**
   * The period controls form one toolbar above the table; there is no search.
   */
  public function testControlsSitInToolbarAboveTable(): void {
    $crawler = new Crawler($this->screen([
      'mode' => 'week',
      'date' => '2026-10-06',
    ]));

    self::assertCount(0, $crawler->filter('[data-canvas-region="filters"]'), 'The filters rail is gone.');
    $toolbar = $crawler->filter('[data-canvas-region="main"] [role="search"]');
    self::assertCount(1, $toolbar, 'The toolbar is missing from main.');
    self::assertCount(1, $toolbar->filter('input[name="mode"][value="week"]'));
    self::assertCount(1, $toolbar->filter('a[href*="mode=day"]:contains("Day")'));
    self::assertCount(1, $toolbar->filter('[aria-current="page"]:contains("Week")'));
    self::assertCount(1, $toolbar->filter('input[name="date"]'));
    self::assertCount(1, $toolbar->filter('[data-option-picker-variant="facet"] input[type="radio"][name="project"]'));
    self::assertCount(0, $crawler->filter('[name="title"]'));
    $main = $crawler->filter('[data-canvas-region="main"]')->html();
    self::assertLessThan(strpos($main, '<table'), strpos($main, 'role="search"'), 'The toolbar sits above the table.');
  }

  /**
   * Each day column header carries that day's recorded total; no day reads blank.
   */
  public function testWeekHeaderCarriesDayTotals(): void {
    $this->createRecorded($this->employee, ['work_date' => '2026-10-06', 'duration_seconds' => 5400]);
    $this->createRecorded($this->employee, ['work_date' => '2026-10-11', 'duration_seconds' => 1800]);

    $week = new Crawler($this->screen(['mode' => 'week', 'date' => '2026-10-06']));

    self::assertSame(
      ['Project', 'Mon 05 0:00', 'Tue 06 1:30', 'Wed 07 0:00', 'Thu 08 0:00', 'Fri 09 0:00', 'Sat 10 0:00', 'Sun 11 0:30', 'Total'],
      $week->filter('table thead th')->each(static fn (Crawler $th): string => trim((string) preg_replace('/\s+/', ' ', $th->text()))),
    );
  }

  /**
   * The week total appears once; no strip, sentence or totals row repeats it.
   */
  public function testWeekTotalOnce(): void {
    $this->createRecorded($this->employee, ['work_date' => '2026-10-06', 'duration_seconds' => 5400]);
    $this->createRecorded($this->employee, ['work_date' => '2026-10-11', 'duration_seconds' => 1800]);

    $html = $this->screen(['mode' => 'week', 'date' => '2026-10-06']);
    $week = new Crawler($html);

    self::assertSame(1, substr_count($html, 'Week total'));
    self::assertMatchesRegularExpression('/Week total\s*2:00/', $week->text());
    self::assertStringNotContainsString('Total recorded time', $week->text());
    self::assertCount(0, $week->filter('nav[aria-label^="Days of week"]'), 'Week mode has no strip.');
    self::assertNotContains('Recorded', $week->filter('table tbody th[scope="row"]')->each(static fn (Crawler $th): string => trim($th->text())));
  }

  /**
   * Day mode keeps its strip and rows; the week grid and its empty state.
   */
  public function testCalendarRendersStripRowsAndGrid(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 5400,
      'description' => 'Tuesday work',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-11',
      'duration_seconds' => 1800,
      'description' => 'Sunday work',
    ]);

    $day = new Crawler($this->screen(['mode' => 'day', 'date' => '2026-10-06']));
    $strip = $day->filter('nav[aria-label="Days of week 2026-10-05"] a');
    self::assertCount(7, $strip);
    $current = $day->filter('nav a[aria-current="date"]');
    self::assertCount(1, $current);
    self::assertSame('Tue 2026-10-06, 1:30', $current->attr('aria-label'));
    self::assertStringContainsString('Week total', $day->filter('nav[aria-label="Days of week 2026-10-05"]')->text());
    self::assertStringContainsString('2:00', $day->filter('nav[aria-label="Days of week 2026-10-05"]')->text());
    self::assertStringContainsString('Total recorded time: 1:30', $day->text());
    self::assertStringContainsString('Tuesday work', $day->text());
    self::assertStringNotContainsString('Sunday work', $day->text());
    self::assertCount(1, $day->filter('a:contains("Open")'));
    self::assertCount(0, $day->filter('table'));

    $week = new Crawler($this->screen(['mode' => 'week', 'date' => '2026-10-06']));
    self::assertCount(1, $week->filter('table'));
    // The label cell is the row header, so every value is announced with it.
    self::assertSame('Customer P · PRJP', trim($week->filter('table tbody tr')->first()->filter('th[scope="row"]')->text()));
    // The employee's own week is the editable timesheet: one input per day.
    self::assertSame(['1:30', '0:30'], array_values(array_filter($week->filter('table tbody tr')->first()->filter('input[type="text"]')->each(static fn (Crawler $input): string => (string) $input->attr('value')))));
    self::assertMatchesRegularExpression('/Week total\s*2:00/', $week->text());
    self::assertStringNotContainsString('Tuesday work', $week->text());

    $empty = new Crawler($this->screen(['mode' => 'week', 'date' => '2026-08-03']));
    self::assertStringContainsString('No time entries for this period.', $empty->text());
    self::assertMatchesRegularExpression('/Week total\s*0:00/', $empty->text());
  }

  /**
   * An unfiltered address states This week above the rows.
   */
  public function testTheDefaultWeekShowsTheEmptySummary(): void {
    $crawler = new Crawler($this->screen([]));
    $empty = $crawler->filter('[data-active-filters="empty"]');
    self::assertCount(1, $empty);
    self::assertSame('This week', trim($empty->text()));
  }

  /**
   * Chosen day, week and project become summary chips above the rows.
   */
  public function testTheSummaryStatesTheChosenPeriodAboveTheRows(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'description' => 'Tuesday hour',
    ]);
    $week = new Crawler($this->screen([
      'mode' => 'week',
      'date' => '2026-10-06',
    ]));
    $chips = $week->filter('[data-active-filters="chips"]');
    self::assertCount(1, $chips);
    self::assertStringContainsString('Week', $chips->text());
    self::assertStringContainsString('2026-10-05', $chips->text());
    self::assertStringContainsString('2026-10-11', $chips->text());
    self::assertCount(0, $week->filter('[data-active-filters="empty"]'));

    $day = new Crawler($this->screen([
      'mode' => 'day',
      'date' => '2026-10-06',
      'project' => (string) $this->project->id(),
    ]));
    $day_chips = $day->filter('[data-active-filters="chips"]');
    self::assertStringContainsString('Day', $day_chips->text());
    self::assertStringContainsString('2026-10-06', $day_chips->text());
    self::assertStringContainsString('PRJP', $day_chips->text());
  }

  /**
   * The unpaged total sits in main, outside the chip strip.
   */
  public function testTheTotalSitsInMainOutsideTheChips(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'duration_seconds' => 3600,
      'description' => 'One hour',
    ]);
    $crawler = new Crawler($this->screen([
      'mode' => 'day',
      'date' => '2026-10-06',
    ]));
    $main = $crawler->filter('[data-canvas-region="main"]');
    self::assertStringContainsString('Total recorded time: 1:00', $main->text());
    self::assertStringNotContainsString(
      'Total recorded time',
      $crawler->filter('[data-active-filters="chips"]')->text(),
    );
  }

  /**
   * An illegal period shows an English error and does not claim This week.
   */
  public function testAnInvalidModeShowsFeedbackAndHidesThisWeek(): void {
    $crawler = new Crawler($this->screen([
      'mode' => 'month',
      'date' => '2026-11-03',
    ]));
    self::assertStringContainsString(
      'Choose Day or Week, a calendar date, and filters offered on this page.',
      $crawler->text(),
    );
    self::assertCount(0, $crawler->filter('[data-active-filters="empty"]'));
    self::assertStringNotContainsString('This week', $crawler->text());
  }

  /**
   * Period chips have no remove link (array query params empty the list).
   */
  public function testPeriodChipsHaveNoRemoveLink(): void {
    $crawler = new Crawler($this->screen([
      'mode' => 'week',
      'date' => '2026-10-06',
    ]));
    self::assertCount(0, $crawler->filter('[data-remove-facet]'));
  }

  /**
   * A leftover title query does not hide rows.
   */
  public function testTitleQueryDoesNotNarrowRows(): void {
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'description' => 'Keep this row',
    ]);
    $this->createRecorded($this->employee, [
      'work_date' => '2026-10-06',
      'description' => 'Drop this row',
    ]);
    $html = $this->screen([
      'mode' => 'day',
      'date' => '2026-10-06',
      'title' => 'Keep this',
    ]);
    self::assertStringContainsString('Keep this row', $html);
    self::assertStringContainsString('Drop this row', $html);
  }

  /**
   * Renders the shipped page as an actor.
   *
   * @param array<string, mixed> $query
   *   Address query.
   */
  private function screen(array $query): string {
    $this->container->get('current_user')->setAccount($this->employee);
    $slug = $this->workspace->getSlug();
    $request = Request::create('/' . $slug . '/time', 'GET', $query);
    $request->attributes->set('bb_workspace', $this->workspace);
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
    self::assertTrue($view->setDisplay('page'));
    $view->override_url = Url::fromRoute('view.worklog.page', [
      'bb_workspace' => $slug,
    ]);
    $view->setArguments([$slug]);
    $view->setExposedInput($query);
    $view->preExecute([$slug]);
    $view->execute('page');
    $build = $view->render('page');
    self::assertIsArray($build);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Turns the display-builder extender on, from the object the repo ships.
   */
  private function enableTheShippedDisplayExtender(): void {
    $file = dirname(__DIR__, 7) . '/config/sync/views.settings.yml';
    self::assertFileExists($file, 'The repository ships views.settings.');
    $shipped = Yaml::parseFile($file);
    self::assertIsArray($shipped);
    self::assertContains(
      'display_builder',
      $shipped['display_extenders'] ?? [],
      'config/sync/views.settings.yml must name the display_builder extender.',
    );
    $this->config('views.settings')
      ->set('display_extenders', $shipped['display_extenders'])
      ->save();
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
      'duration_seconds' => $values['duration_seconds'] ?? 3600,
      'description' => $values['description'] ?? 'Review changes',
      'derivation' => 'manual',
      'state' => 'recorded',
      'project_id' => $values['project_id'] ?? $this->project->id(),
      'ticket_id' => NULL,
    ]);
    LegacyWorklogFixture::save($entry);
    self::assertInstanceOf(Worklog::class, $entry);
    return $entry;
  }

  /**
   * Creates a group in a workspace.
   */
  private function createGroup(string $name): BbGroupInterface {
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create([
        'name' => $name,
        'workspace_id' => $this->workspace->id(),
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

}
