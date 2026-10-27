<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Access\BbWorkspaceAccessCheck;
use Drupal\bb_core\Controller\BbStatsController;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\Tests\bb_core\Kernel\Statistics\EpicTermTrait;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\Core\Access\AccessResultReasonInterface;
use Drupal\Core\Routing\RouteMatch;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\bb_core\Kernel\Statistics\InsightsFixtureTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Covers Project › Stats: the Insights building blocks for one project.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ProjectStatsRouteTest extends KernelTestBase {

  use EpicTermTrait;

  use OgScopeFixtureTrait;
  use UserCreationTrait;
  use InsightsFixtureTrait;

  private const ROUTE = 'bb_core.bb_project.stats';

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
   * The workspace holding the project.
   */
  private BbWorkspaceInterface $north;

  /**
   * The project whose Stats tab is under test.
   */
  private BbProjectInterface $atlas;

  /**
   * The project's epic.
   */
  private BbTicketInterface $epic;

  /**
   * Whether the page fixture already closed a ticket this month.
   */
  private bool $closedOnce = FALSE;

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
    $this->installInsightsFigures();
    $this->atlas = $this->project($this->north, 'Atlas', 'ATL');
    $this->epic = $this->ticket($this->atlas, 'epic', 'Checkout', FALSE);
  }

  /**
   * A lead and a guest of the workspace reach the tab; an outsider gets 403.
   */
  public function testProjectViewersGetThePageOutsidersAre403(): void {
    foreach (['lead', 'guest'] as $rank) {
      self::assertTrue($this->access($this->member($this->north, 'north-' . $rank, [$rank]))->isAllowed(), "A $rank opens Project › Stats.");
    }
    $south = $this->workspace('South', 'south');
    $result = $this->access($this->member($south, 'south-contributor', ['contributor']));
    self::assertTrue($result->isForbidden());
    self::assertNotSame(BbWorkspaceAccessCheck::WORKSPACE_MISMATCH_REASON, $this->reason($result), 'The entity gate answers 403, not the workspace 404.');
  }

  /**
   * The tab shows the period, tiles, flow chart, People and both filters.
   */
  public function testPageShowsTheInsightsBuildingBlocks(): void {
    $build = $this->page([]);
    $range = $this->components($build, 'bb_theme:period-range')[0]['#props'];
    self::assertSame('month', $range['kind']);
    self::assertSame('/north/project/atl/stats', $range['action']);
    self::assertSame(['Throughput', 'Runs per ticket', 'Rating', 'AI usage'], array_map(static fn(array $tile): string => $tile['#props']['label'], $this->components($build, 'bb_theme:stat-tile')));
    self::assertCount(1, $this->components($build, 'bb_theme:flow-chart'));
    self::assertCount(1, $this->components($build, 'bb_theme:table'));
    self::assertSame(['Epic · All epics', 'Person · All'], $this->pickerLabels($build));
  }

  /**
   * The replaced figures, hours and the export never appear.
   */
  public function testReplacedFiguresAreGone(): void {
    $figures = $this->page([])['content']['figures']['#slots']['content'];
    self::assertSame(['insights'], array_keys($figures));
    self::assertSame(['project_overview', 'project_flow', 'project_people'], array_keys($figures['insights']['#slots']['content']));
    $json = json_encode($this->page([]), JSON_THROW_ON_ERROR);
    foreach (['Tickets trend', 'Runs trend', 'Tokens trend', 'Token spend by model', 'hours', 'Export'] as $text) {
      self::assertStringNotContainsString($text, $json);
    }
  }

  /**
   * The epic picker offers one choice, starting with All epics.
   */
  public function testEpicPickerOffersOneChoice(): void {
    $panel = $this->components($this->page([]), 'bb_theme:option_list')[0]['#props'];
    self::assertSame('filter[epic][]', $panel['input_name']);
    self::assertFalse($panel['multiple']);
    self::assertSame('radio', $panel['input_type']);
    self::assertFalse($panel['bulk_actions']);
    self::assertSame(['All epics', 'Checkout'], array_column($panel['options'], 'label'));
    self::assertSame('', $panel['options'][0]['value']);
  }

  /**
   * An epic of another project, or no epic, is dropped rather than an error.
   */
  public function testForeignEpicIsDroppedOnPage(): void {
    $foreign = $this->ticket($this->project($this->north, 'Pfiff', 'PFF'), 'epic', 'Other', FALSE);
    $loose = $this->ticket($this->atlas, 'bb_work', 'Loose', FALSE);
    foreach ([$foreign, $loose] as $ticket) {
      $build = $this->page(['filter' => ['epic' => [$ticket->uuid()]]]);
      self::assertSame('Epic · All epics', $this->pickerLabels($build)[0]);
      self::assertCount(4, $this->components($build, 'bb_theme:stat-tile'));
    }
  }

  /**
   * Selected filters name themselves, ride along the period, and clear.
   */
  public function testFiltersStayInTheUrlAndClear(): void {
    $alice = $this->member($this->north, 'Alice Baker', ['member']);
    $this->ticket($this->atlas, 'bb_work', 'Done', TRUE, $alice);
    $build = $this->page(['filter' => ['period' => 'year', 'epic' => [$this->epic->uuid()], 'user' => [$alice->uuid()]]]);
    self::assertSame(['Epic · Checkout', 'Person · Alice Baker'], $this->pickerLabels($build));
    self::assertSame([
      ['name' => 'filter[epic][]', 'value' => $this->epic->uuid()],
      ['name' => 'filter[user][]', 'value' => $alice->uuid()],
    ], $this->components($build, 'bb_theme:period-range')[0]['#props']['params']);
    $clear = array_values(array_filter($this->components($build, 'bb_theme:button'), static fn(array $button): bool => $button['#props']['label'] === 'Clear filters'));
    self::assertSame('/north/project/atl/stats?filter%5Bperiod%5D=year', $clear[0]['#props']['href']);
  }

  /**
   * A tick fetches this tab and refreshes the project's filter parts only.
   */
  public function testFiltersApplyToThisTabThroughHtmx(): void {
    $attributes = $this->page([])['controls']['#slots']['content']['filters']['#attributes'];
    self::assertSame('/north/project/atl/stats', $attributes['data-hx-get']);
    self::assertSame(
      ['#insights-filter-epic', '#insights-filter-user', '#insights-period', '#insights-clear'],
      explode(',', $attributes['data-hx-select-oob']),
    );
  }

  /**
   * Without a closed ticket the figures give way to the project empty state.
   */
  public function testEmptyStateWhenNothingClosed(): void {
    $build = $this->page([], FALSE);
    self::assertSame([], $this->components($build, 'bb_theme:stat-tile'));
    $headings = array_map(static fn(array $zone): string => (string) ($zone['#slots']['heading']['#plain_text'] ?? ''), $this->components($build, 'bb_theme:zone'));
    self::assertCount(1, preg_grep('/^No closed tickets in .+ yet$/', $headings) ?: []);
    $button = $this->components($build, 'bb_theme:button')[0]['#props'];
    self::assertSame('Open tickets', $button['label']);
    self::assertSame('/north/project/atl/tickets', $button['href']);
  }

  /**
   * Renders the Atlas Stats tab as a workspace lead.
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
    if ($closed && !$this->closedOnce) {
      $this->closedOnce = TRUE;
      $this->ticket($this->atlas, 'bb_work', 'Closed', TRUE);
    }
    $route = $this->container->get('router.route_provider')->getRouteByName(self::ROUTE);
    $request = Request::create('/north/project/atl/stats', 'GET', $query);
    $request->setSession($this->container->get('request_stack')->getCurrentRequest()->getSession());
    $this->container->get('request_stack')->push($request);
    $controller = BbStatsController::create($this->container);
    $match = new RouteMatch(
      self::ROUTE,
      $route,
      ['bb_workspace' => $this->north, 'bb_project' => $this->atlas],
      ['bb_workspace' => 'north', 'bb_project' => 'atl'],
    );
    return $controller->projectStats($match, $request);
  }

  /**
   * The filter buttons as "label · value".
   *
   * @param array<string, mixed> $build
   *   The page.
   *
   * @return list<string>
   *   The button texts.
   */
  private function pickerLabels(array $build): array {
    return array_values(array_map(
      static fn(array $picker): string => $picker['#props']['label'] . ' · ' . $picker['#props']['value_label'],
      $this->components($build, 'bb_theme:option_picker'),
    ));
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
   * The access result for the Atlas Stats tab.
   *
   * @return \Drupal\Core\Access\AccessResultInterface
   *   The result.
   */
  private function access(mixed $account): mixed {
    return $this->container->get('access_manager')->checkNamedRoute(self::ROUTE, $this->atlas->toUrl()->getRouteParameters(), $account, TRUE);
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
   * Creates a project with a key in a workspace.
   */
  private function project(BbWorkspaceInterface $workspace, string $name, string $key): BbProjectInterface {
    $storage = $this->container->get('entity_type.manager');
    $group = $storage->getStorage('bb_group')->create(['name' => $name . '-group', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $storage->getStorage('bb_project')->create(['name' => $name, 'key' => $key, 'group_id' => $group->id()]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Creates a ticket in a project, closed this month when asked.
   */
  private function ticket(BbProjectInterface $project, string $workflow, string $title, bool $closed, ?UserInterface $assignee = NULL): BbTicketInterface {
    $now = $this->container->get('datetime.time')->getRequestTime();
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->create([
      'workflow' => 'bb_work',
      'ticket_type' => $workflow === 'epic' ? $this->epicTerm($project)->id() : NULL,
      'title' => $title,
      'project_id' => $project->id(),
      'assignee_user_id' => $assignee?->id(),
      'created' => $now - 60,
      'closed' => $closed,
      'closed_date' => $closed ? $now - 60 : NULL,
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return $ticket;
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
