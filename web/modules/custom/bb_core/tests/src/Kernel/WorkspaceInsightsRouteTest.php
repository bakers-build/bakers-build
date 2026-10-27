<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Access\BbWorkspaceAccessCheck;
use Drupal\bb_core\Controller\BbStatsController;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\InsightsPage;
use Drupal\Core\Routing\RouteMatch;
use Drupal\Tests\bb_core\Kernel\Statistics\InsightsFixtureTrait;
use Symfony\Component\HttpFoundation\Request;
use Drupal\Core\Access\AccessResultReasonInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Covers the lead-only workspace Insights route.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceInsightsRouteTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;
  use InsightsFixtureTrait;

  private const ROUTE = 'bb_core.workspace.insights';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'og',
    'ui_patterns', 'bb_core',
  ];

  /**
   * The workspace whose Insights page is under test.
   */
  private BbWorkspaceInterface $north;

  /**
   * The other bakery.
   */
  private BbWorkspaceInterface $south;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_conductor', 'bb_ticket', 'bb_comment', 'bb_run', 'bb_term',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->container->get('router.builder')->rebuild();
    $this->createUser([], 'uid1-dummy');
    $this->north = $this->workspace('North', 'north');
    $this->south = $this->workspace('South', 'south');
    $this->installInsightsFigures();
  }

  /**
   * The shell renders the title and the Overview tab; the page adds no header.
   */
  public function testHeaderShowsWorkspaceSublineAndOverviewTab(): void {
    self::assertSame([], $this->components($this->page([]), 'bb_theme:page_header'), 'No second page header in the content.');
    $tasks = $this->container->get('plugin.manager.menu.local_task')->getLocalTasksForRoute(self::ROUTE);
    self::assertSame('Overview', (string) $tasks[0]['bb_core.workspace.insights']->getTitle());
    self::assertSame('North · all projects, all teams', $this->insightsPage()->scope($this->north, []));
  }

  /**
   * The page opens on this month.
   */
  public function testPeriodDefaultsToThisMonth(): void {
    $range = $this->components($this->page([]), 'bb_theme:period-range')[0]['#props'];
    self::assertSame('month', $range['kind']);
    self::assertSame('filter', $range['name']);
    self::assertSame('/north/insights', $range['action']);
  }

  /**
   * All time starts at the workspace's earliest closed ticket.
   */
  public function testAllTimeStartsAtTheEarliestTicket(): void {
    $now = $this->container->get('datetime.time')->getRequestTime();
    $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'title' => 'old',
      'project_id' => $this->project($this->north, 'old')->id(),
      'created' => $now - 400 * 86400,
      'closed' => TRUE,
      'closed_date' => $now - 400 * 86400,
    ])->save();
    $range = $this->components($this->page(['filter' => ['period' => 'all']]), 'bb_theme:period-range')[0]['#props'];
    self::assertSame(gmdate('Y-m-d', $now - 400 * 86400), $range['date']);
  }

  /**
   * A selected period reaches every figure, the flow chart's grouping included.
   */
  public function testPeriodSelectionReachesAllFigures(): void {
    $build = $this->page(['filter' => ['period' => 'year']]);
    self::assertSame('year', $this->components($build, 'bb_theme:period-range')[0]['#props']['kind']);
    $chart = $this->components($build, 'bb_theme:flow-chart')[0]['#props']['chart'];
    self::assertStringStartsWith('Per month, UTC', $chart['caption']);
  }

  /**
   * A month is grouped per day.
   */
  public function testFlowChartCaptionNamesGrouping(): void {
    $chart = $this->components($this->page([]), 'bb_theme:flow-chart')[0]['#props']['chart'];
    self::assertStringStartsWith('Per day, UTC', $chart['caption']);
  }

  /**
   * Without a closed ticket the figures give way to an explained empty state.
   */
  public function testEmptyStateWhenNothingClosed(): void {
    $build = $this->page([], FALSE);
    self::assertNotEmpty($this->components($build, 'bb_theme:period-range'), 'The period stays selectable.');
    self::assertSame([], $this->components($build, 'bb_theme:stat-tile'));
    $headings = array_map(static fn(array $zone): string => (string) ($zone['#slots']['heading']['#plain_text'] ?? ''), $this->components($build, 'bb_theme:zone'));
    self::assertCount(1, preg_grep('/^No closed tickets in .+ yet$/', $headings) ?: []);
  }

  /**
   * A filter value from another workspace is dropped on the page, not an error.
   */
  public function testForeignFilterUuidIsDroppedOnPage(): void {
    $foreign = $this->project($this->south, 'south-shop');
    $build = $this->page(['filter' => ['project' => [$foreign->uuid()]]]);
    self::assertCount(4, $this->components($build, 'bb_theme:stat-tile'));
  }

  /**
   * Changing the period keeps the Project, Team and Person filters.
   */
  public function testPeriodChangeKeepsEntityFilters(): void {
    $atlas = $this->project($this->north, 'atlas');
    $build = $this->page(['filter' => ['project' => [$atlas->uuid()], 'period' => 'year']]);
    $range = $this->components($build, 'bb_theme:period-range')[0]['#props'];
    self::assertSame([['name' => 'filter[project][]', 'value' => $atlas->uuid()]], $range['params'] ?? NULL);
  }

  /**
   * Each filter button names its selection, or All.
   */
  public function testButtonLabelsShowSelection(): void {
    $labels = fn(array $build): array => array_map(
      static fn(array $picker): string => $picker['#props']['label'] . ' · ' . $picker['#props']['value_label'],
      $this->components($build, 'bb_theme:option_picker'),
    );
    self::assertSame(['Project · All', 'Team · All', 'Person · All'], $labels($this->page([])));

    $atlas = $this->project($this->north, 'atlas');
    $pfiff = $this->project($this->north, 'pfiff');
    $build = $this->page(['filter' => ['project' => [$pfiff->uuid(), $atlas->uuid()]]]);
    self::assertSame('Project · atlas, pfiff', $labels($build)[0]);
    $panel = $this->components($build, 'bb_theme:option_list')[0]['#props'];
    self::assertSame('filter[project]', $panel['input_name']);
    self::assertTrue($panel['bulk_actions']);
    self::assertSame('Apply', $panel['apply_label']);
    $selected = array_column($panel['options'], 'selected', 'label');
    self::assertSame(['atlas' => TRUE, 'pfiff' => TRUE], array_intersect_key($selected, ['atlas' => 1, 'pfiff' => 1]));
  }

  /**
   * The sub-line summarises the active filters.
   */
  public function testSublineSummarisesFilters(): void {
    $atlas = $this->project($this->north, 'atlas');
    $pfiff = $this->project($this->north, 'pfiff');
    $alice = $this->member($this->north, 'Alice Baker', ['member']);
    $filters = ['project' => [$atlas->uuid(), $pfiff->uuid()], 'user' => [$alice->uuid()]];
    self::assertSame('North · 2 projects · Alice Baker', $this->insightsPage()->scope($this->north, $filters));
  }

  /**
   * Clear filters keeps the period and drops every entity filter.
   */
  public function testClearFiltersKeepsPeriodOnly(): void {
    $atlas = $this->project($this->north, 'atlas');
    $build = $this->page(['filter' => ['period' => 'year', 'project' => [$atlas->uuid()]]]);
    $clear = array_values(array_filter($this->components($build, 'bb_theme:button'), static fn(array $button): bool => $button['#props']['label'] === 'Clear filters'));
    self::assertCount(1, $clear);
    self::assertSame('/north/insights?filter%5Bperiod%5D=year', $clear[0]['#props']['href']);
    self::assertSame([], array_filter($this->components($this->page([]), 'bb_theme:button'), static fn(array $button): bool => $button['#props']['label'] === 'Clear filters'));
  }

  /**
   * Every tick applies through htmx and leaves the open popover alone.
   *
   * The form GETs the page on each change and swaps only the figures region
   * plus the header parts the filters change; the pickers' panels are never
   * swapped, so search, scroll and focus survive. Apply is for no JavaScript.
   */
  public function testFiltersApplyOnChangeThroughHtmx(): void {
    $build = $this->page([]);
    $form = $build['controls']['#slots']['content']['filters'];
    $attributes = $form['#attributes'];
    self::assertSame('get', $form['#method']);
    self::assertSame('/north/insights', $attributes['data-hx-get']);
    self::assertStringStartsWith('change', $attributes['data-hx-trigger']);
    self::assertSame('#insights-figures', $attributes['data-hx-target']);
    self::assertSame('#insights-figures', $attributes['data-hx-select']);
    self::assertStringStartsWith('outerHTML', $attributes['data-hx-swap']);
    self::assertSame('true', $attributes['data-hx-push-url']);
    self::assertSame(
      [
        '#insights-filter-project',
        '#insights-filter-team',
        '#insights-filter-user',
        '#insights-period',
        '#insights-clear',
        '#page-header-description',
      ],
      explode(',', $attributes['data-hx-select-oob']),
    );
    self::assertContains('core/drupal.htmx', $form['#attached']['library']);
    self::assertSame('insights-figures', $build['content']['#attributes']['id']);
    // Back after a tick refetches the page instead of restoring a snapshot.
    self::assertSame('false', $build['content']['#attributes']['data-hx-history']);
    // The swap targets exist before the first filter, so a tick can fill them.
    self::assertSame('insights-period', $build['controls']['#slots']['content']['period']['#attributes']['id']);
    self::assertSame('insights-clear', $build['controls']['#slots']['content']['clear']['#attributes']['id']);
    foreach ($this->components($build, 'bb_theme:option_list') as $panel) {
      self::assertTrue($panel['#props']['auto_apply']);
    }
    $empty = $this->page([], FALSE);
    self::assertSame('insights-figures', $empty['content']['#attributes']['id']);
  }

  /**
   * The htmx request's own parameters never reach the links the page builds.
   *
   * A copied sort or pager link carrying ajax_page_state would load a page
   * that believes its CSS and JS are already present.
   */
  public function testHtmxRequestParametersStayOutOfTableLinks(): void {
    $build = $this->page([
      'filter' => ['period' => 'year'],
      'ajax_page_state' => ['theme' => 'bb_theme', 'theme_token' => 'x', 'libraries' => 'core/drupal.htmx'],
      '_wrapper_format' => 'drupal_htmx',
      '_triggering_element_name' => 'x',
    ]);
    $tables = json_encode($this->components($build, 'bb_theme:table'), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    self::assertStringContainsString('filter%5Bperiod%5D=year', $tables);
    foreach (['ajax_page_state', '_wrapper_format', '_triggering_element_name'] as $parameter) {
      self::assertStringNotContainsString($parameter, $tables);
    }
  }

  /**
   * Renders the north Insights page as its lead.
   *
   * @param array<string, mixed> $query
   *   The request query.
   * @param bool $closed
   *   Whether a ticket was closed this month.
   *
   * @return array<string, mixed>
   *   The page render array.
   */
  private function page(array $query, bool $closed = TRUE): array {
    $lead = user_load_by_name('north-lead') ?: $this->member($this->north, 'north-lead', ['lead']);
    $this->setCurrentUser($lead);
    if ($closed) {
      $project = $this->project($this->north, 'atlas');
      $now = $this->container->get('datetime.time')->getRequestTime();
      $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
        'workflow' => 'bb_work',
        'title' => 'closed',
        'project_id' => $project->id(),
        'created' => $now - 60,
        'closed' => TRUE,
        'closed_date' => $now - 60,
      ])->save();
    }
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ROUTE);
    $request = Request::create('/north/insights', 'GET', $query);
    $request->setSession($this->container->get('request_stack')->getCurrentRequest()->getSession());
    $this->container->get('request_stack')->push($request);
    $controller = BbStatsController::create($this->container);
    return $controller->insights(new RouteMatch(self::ROUTE, $route, ['bb_workspace' => $this->north], ['bb_workspace' => 'north']), $request);
  }

  /**
   * The Insights page service.
   */
  private function insightsPage(): InsightsPage {
    $page = $this->container->get('bb_core.insights_page');
    self::assertInstanceOf(InsightsPage::class, $page);
    return $page;
  }

  /**
   * Every component render array of one id, depth first.
   *
   * @param array<mixed> $build
   *   A render array.
   * @param string $id
   *   The component id.
   *
   * @return array<int, array<string, mixed>>
   *   The matching render arrays.
   */
  private function components(array $build, string $id): array {
    $found = ($build['#component'] ?? NULL) === $id ? [$build] : [];
    foreach ($build as $value) {
      if (is_array($value)) {
        array_push($found, ...$this->components($value, $id));
      }
    }
    return $found;
  }

  /**
   * Creates a project in a workspace.
   */
  private function project(BbWorkspaceInterface $workspace, string $name): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $storage->getStorage('bb_project')->create(['name' => $name, 'group_id' => $group->id()]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * The public path is the workspace slug followed by insights.
   */
  public function testRouteLivesUnderTheWorkspaceSlug(): void {
    self::assertSame('/north/insights', Url::fromRoute(self::ROUTE, ['bb_workspace' => 'north'])->toString());
  }

  /**
   * A lead of the workspace may open the page, titled Insights.
   */
  public function testLeadGetsInsightsPage(): void {
    $lead = $this->member($this->north, 'north-lead', ['lead']);
    self::assertTrue($this->access($lead)->isAllowed());
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ROUTE);
    self::assertSame('Insights', $route->getDefault('_title'));
  }

  /**
   * Contributors, members and guests of the workspace are refused.
   */
  public function testNonLeadMemberGets403(): void {
    foreach (['contributor', 'member', 'guest'] as $rank) {
      $account = $this->member($this->north, 'north-' . $rank, [$rank]);
      $result = $this->access($account);
      self::assertFalse($result->isAllowed(), "A $rank is refused.");
      self::assertNotSame(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON, $this->reason($result), "A $rank gets 403, not 404.");
    }
  }

  /**
   * A lead of another workspace is refused at the workspace boundary.
   *
   * The boundary answers 404 rather than 403, so it never reveals that a
   * workspace exists to an account outside it.
   */
  public function testForeignLeadIsRefused(): void {
    $southLead = $this->member($this->south, 'south-lead', ['lead']);
    $result = $this->access($southLead);
    self::assertTrue($result->isForbidden());
    self::assertSame(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON, $this->reason($result));
  }

  /**
   * An anonymous visitor is refused; the login redirect handles the rest.
   */
  public function testAnonymousIsRefused(): void {
    self::assertFalse($this->access(new AnonymousUserSession())->isAllowed());
  }

  /**
   * The access result for the north Insights page.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   The result.
   */
  private function access(mixed $account): mixed {
    return $this->container->get('access_manager')->checkNamedRoute(self::ROUTE, ['bb_workspace' => 'north'], $account, TRUE);
  }

  /**
   * The reason of a forbidden result, or ''.
   */
  private function reason(mixed $result): string {
    return $result instanceof AccessResultReasonInterface ? (string) $result->getReason() : '';
  }

  /**
   * Creates a workspace with a slug.
   */
  private function workspace(string $name, string $slug): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => $name, 'slug' => $slug]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    return $workspace;
  }

  /**
   * Creates an account with ranks in a workspace.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param string $name
   *   The account name.
   * @param array<string> $ranks
   *   The OG role names.
   */
  private function member(BbWorkspaceInterface $workspace, string $name, array $ranks): UserInterface {
    $account = $this->createUser([], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->addMembership($workspace, $account, $ranks);
    return $account;
  }

}
