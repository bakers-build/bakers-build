<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\search_api\Entity\Index;
use Drupal\facets_exposed_filters\Plugin\views\filter\FacetsFilter;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\TypedData\ComplexDataInterface;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use Drupal\views\ViewExecutable;
use Drupal\views\Routing\ViewPageController;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;

/**
 * Executes the project and team ticket displays against real Search API data.
 *
 * Configuration-only assertions cannot establish that the route argument is
 * applied before optional filters, that a project's second team is included,
 * that index refreshes follow relation changes, or that the display remains
 * access-scoped. These cases execute the displays through Views instead.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketsContextualDisplayTest extends KernelTestBase {

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    'views_filters_summary', 'ui_patterns', 'ui_patterns_views',
    'display_builder', 'display_builder_views', 'island', 'bb_core',
  ];

  /**
   * The reader who is a project member in workspace A only.
   */
  private UserInterface $reader;

  /**
   * Workspace A's project and its first team.
   */
  private BbProjectInterface $projectA;

  /**
   * The first team assigned to the project.
   */
  private BbTeamInterface $teamA;

  /**
   * A second project team, not assigned directly to the original ticket.
   */
  private BbTeamInterface $teamASecond;

  /**
   * The first project's original ticket.
   */
  private BbTicketInterface $ticketA;

  /**
   * A second ticket in the review state.
   */
  private BbTicketInterface $ticketAReview;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    $this->installSchema('search_api', ['search_api_item']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install it from the
    // recipe copy (its search_api index dependency is swept in just above).
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    $this->buildTwoWorkspaceWorld();
    $project = $this->fixture('a', 'bb_project');
    $team = $this->fixture('a', 'bb_team');
    self::assertInstanceOf(BbProjectInterface::class, $project);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $this->projectA = $project;
    $this->teamA = $team;

    $second = $this->createEntity('bb_team', [
      'name' => 'team-a-second',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $second);
    $this->teamASecond = $second;
    $this->projectA->set('teams', [$this->teamA->id(), $second->id()])->save();

    $ticket = $this->fixture('a', 'bb_ticket');
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $this->ticketA = $ticket;
    $review = $this->createEntity('bb_ticket', [
      'title' => 'ticket-a-review',
      'workflow' => 'bb_work',
      'state' => 'review',
      'project_id' => $this->projectA->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $review);
    $this->ticketAReview = $review;

    $reader = $this->createAccount('context-reader', ['view bb_ticket', 'view bb_project', 'view bb_team']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['member']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->teamA, $reader, []);
    $this->reader = $reader;
    $this->backfillTicketIndex();
  }

  /**
   * Project context narrows filters and excludes inaccessible tickets.
   */
  public function testProjectDisplayUsesRouteContextBeforeOptionalFilters(): void {
    foreach ([$this->projectA->get('key')->value, $this->projectA->uuid()] as $reference) {
      self::assertSame(
        [(int) $this->ticketA->id(), (int) $this->ticketAReview->id()],
        $this->ticketIds('project_tickets', [$reference]),
      );
    }
    self::assertSame(
      [(int) $this->ticketA->id(), (int) $this->ticketAReview->id()],
      $this->ticketIds('project_tickets', [$this->projectA->id()]),
    );
    self::assertSame(
      [(int) $this->ticketAReview->id()],
      $this->ticketIds(
        'project_tickets',
        [$this->projectA->id()],
        ['state' => ['review']],
      ),
    );
    self::assertSame(
      [],
      $this->ticketIds('project_tickets', [$this->fixture('b', 'bb_project')->id()]),
    );
    $this->addMembership($this->fixture('b', 'bb_workspace'), $this->reader, ['member']);
    $this->addMembership($this->fixture('b', 'bb_team'), $this->reader, []);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    self::assertSame(
      [],
      $this->ticketIds('project_tickets', [$this->fixture('b', 'bb_project')->id()]),
      'Even a reader in both workspaces cannot mix the workspace and project arguments.',
    );
  }

  /**
   * Team context follows all project teams and respects workspace access.
   */
  public function testTeamDisplayUsesTheProjectTeamsRelation(): void {
    self::assertSame(
      [(int) $this->ticketA->id(), (int) $this->ticketAReview->id()],
      $this->ticketIds('team_tickets', [$this->teamASecond->id()]),
    );
    self::assertSame(
      [],
      $this->ticketIds('team_tickets', [$this->fixture('b', 'bb_team')->id()]),
    );
  }

  /**
   * Backfill and relation mutations update the contextual team query.
   */
  public function testTeamDisplayFollowsBackfillAndRelationChanges(): void {
    $this->projectA->set('teams', [$this->teamA->id()])->save();
    $this->backfillTicketIndex();
    self::assertSame(
      [],
      $this->ticketIds('team_tickets', [$this->teamASecond->id()]),
    );

    $this->projectA->set('teams', [$this->teamA->id(), $this->teamASecond->id()])->save();
    $this->backfillTicketIndex();
    self::assertSame(
      [(int) $this->ticketA->id(), (int) $this->ticketAReview->id()],
      $this->ticketIds('team_tickets', [$this->teamASecond->id()]),
    );
  }

  /**
   * Every exposed filter and their conjunction narrow a real contextual query.
   */
  public function testFilterCombinationsCountsAndFacets(): void {
    $this->ticketAReview->set('priority', 1)
      ->set('assignee_user_id', $this->reader->id())
      ->set('labels', [$this->fixture('a', 'bb_term')->id()])->save();
    $this->backfillTicketIndex();
    $common = [
      'group' => [$this->fixture('a', 'bb_group')->id()],
      'state' => ['review'],
      'workflow' => ['bb_work'],
      'assignee' => [$this->reader->id()],
      'priority' => [1],
      'label' => [$this->fixture('a', 'bb_term')->id()],
    ];
    foreach (['project_tickets', 'team_tickets'] as $display) {
      $arguments = [(string) ($display === 'project_tickets' ? $this->projectA->id() : $this->teamA->id())];
      // Group and Team are constant within a project, so project_tickets
      // does not expose them; they are covered as forged keys below.
      $filters = $display === 'project_tickets'
        ? array_diff_key($common, ['group' => TRUE])
        : $common + ['project' => [$this->projectA->id()]];
      foreach ($filters as $key => $value) {
        $view = $this->executeDisplay($display, $arguments, [$key => $value, 'state' => ['review']]);
        self::assertCount(1, $view->result, $display . ': ' . $key);
        self::assertSame(1, (int) $view->total_rows);
      }
      self::assertSame([(int) $this->ticketAReview->id()], $this->ticketIds($display, $arguments, $filters));
      $filters['state'] = ['qualification'];
      self::assertSame([], $this->ticketIds($display, $arguments, $filters));
      // Hidden or removed selectors cannot replace the route argument.
      $forged = $display === 'project_tickets'
        ? [
          'project' => [$this->fixture('b', 'bb_project')->id()],
          'group' => [$this->fixture('b', 'bb_group')->id()],
          'team' => [$this->fixture('b', 'bb_team')->id()],
        ]
        : ['team' => [$this->fixture('b', 'bb_team')->id()]];
      self::assertSame(
        [(int) $this->ticketA->id(), (int) $this->ticketAReview->id()],
        $this->ticketIds($display, $arguments, $forged),
      );
      $view = $this->executeDisplay($display, $arguments);
      self::assertCount(2, $view->result, 'Multi-valued teams do not duplicate rows.');
      self::assertSame(2, (int) $view->total_rows);
      $workflow = $view->filter['facets_workflow'];
      self::assertInstanceOf(FacetsFilter::class, $workflow);
      self::assertNotEmpty($workflow->facet_results);
      foreach ($workflow->facet_results as $result) {
        self::assertContains($result->getRawValue(), ['bb_work', 'bb_work']);
      }
    }
  }

  /**
   * Ticket project mutations change both contextual listings after indexing.
   */
  public function testTicketProjectMutationUpdatesContext(): void {
    $this->ticketAReview->set('project_id', $this->fixture('b', 'bb_project')->id())->save();
    $this->backfillTicketIndex();
    self::assertSame([(int) $this->ticketA->id()], $this->ticketIds('project_tickets', [$this->projectA->id()]));
    self::assertSame([(int) $this->ticketA->id()], $this->ticketIds('team_tickets', [$this->teamASecond->id()]));
    $this->ticketAReview->set('project_id', $this->projectA->id())->save();
    $this->backfillTicketIndex();
    self::assertSame(
      [(int) $this->ticketA->id(), (int) $this->ticketAReview->id()],
      $this->ticketIds('team_tickets', [$this->teamASecond->id()]),
    );
  }

  /**
   * A shared contextual URL never turns "in the workspace" into ticket access.
   *
   * Rewritten for BB-462 D4, which overturns this test's old premise: team
   * membership now DOES grant ticket access (a project is visible exactly to
   * the members of a team it names), so a reader who belongs to `teamA` itself
   * would legitimately see its tickets. What must still fail closed is a
   * reader who received the shared URL but belongs to neither `teamA` nor
   * `teamASecond` — the argument alone must not substitute for real team
   * membership.
   */
  public function testSharedContextRespectsEachReadersProjectScope(): void {
    $arguments = [(string) $this->teamA->id()];
    // Each HTTP request starts with fresh request-local facet state.
    // The cross-account browser path covers reuse of the same cached URL.
    $unrelated_team = $this->createEntity('bb_team', [
      'name' => 'team-a-unrelated',
      'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
    ]);
    $team_only = $this->createAccount('team-only', ['view bb_ticket', 'view bb_project', 'view bb_team']);
    $this->addMembership($this->fixture('a', 'bb_workspace'), $team_only, ['member']);
    $this->addMembership($unrelated_team, $team_only, []);
    $this->reader = $team_only;
    $view = $this->executeDisplay('team_tickets', $arguments);
    self::assertSame([], $view->result);
    self::assertSame(0, (int) $view->total_rows);
    // BB-490's bb_closed_rows sits alongside the facet filters on this
    // display but is not itself a facet, so it is excluded from this
    // facet-values assertion rather than widening the loop to assume every
    // filter handler is a FacetsFilter.
    foreach ($view->filter as $filter) {
      if (!$filter instanceof FacetsFilter) {
        continue;
      }
      self::assertEmpty($filter->facet_results, 'No inaccessible facet values are offered.');
    }

  }

  /**
   * Empty contexts and filtered results render the configured no-results text.
   */
  #[DataProvider('emptyContexts')]
  public function testContextualEmptyStatesRenderConfiguredMessage(string $display, bool $filtered, string $message): void {
    if ($filtered) {
      $entity = $display === 'team_tickets' ? $this->teamA : $this->projectA;
      $input = ['state' => ['done']];
    }
    elseif ($display === 'project_tickets') {
      // BB-462 D4/D7: no membership to add — the reader already sees this
      // project via its `teams` reference to teamA, which it joined in
      // setUp(). Direct project OG membership no longer exists.
      $entity = $this->createEntity('bb_project', [
        'name' => 'empty-project',
        'key' => 'empty',
        'group_id' => $this->fixture('a', 'bb_group')->id(),
        'teams' => [$this->teamA->id()],
      ]);
      $input = [];
    }
    else {
      $entity = $this->createEntity('bb_team', [
        'name' => 'empty-team',
        'workspace_id' => $this->fixture('a', 'bb_workspace')->id(),
      ]);
      $input = [];
    }
    self::assertStringContainsString($message, $this->rendered($display, [$entity->id()], $input));
  }

  /**
   * Independent page requests for empty and filtered-empty contexts.
   *
   * @return array<string, array{string, bool, string}>
   *   Display, filter state and expected user-facing message.
   */
  public static function emptyContexts(): array {
    return [
      'empty project' => ['project_tickets', FALSE, 'This project has no tickets.'],
      'filtered project' => ['project_tickets', TRUE, 'No entries match the selected filters.'],
      'empty team' => ['team_tickets', FALSE, 'This team has no tickets.'],
      'filtered team' => ['team_tickets', TRUE, 'No entries match the selected filters.'],
    ];
  }

  /**
   * Missing and forged contexts never produce a global ticket query.
   */
  public function testContextualDisplaysFailClosedWithoutTheirRouteArgument(): void {
    foreach (['project_tickets', 'team_tickets'] as $display) {
      $view = $this->executeDisplay($display, []);
      self::assertSame([], $view->result, $display . ' returns no rows without context.');
      self::assertTrue(
        !empty($view->build_info['denied']) || !empty($view->build_info['fail']),
        $display . ' rejects a missing context.',
      );

      foreach (['all', '', 'not-an-entity', '99999999', '1+2'] as $invalid) {
        $view = $this->executeDisplay($display, [$invalid]);
        self::assertSame([], $view->result, $display . ' rejects: ' . $invalid);
      }
    }
  }

  /**
   * Drupal's Views controller passes both URL arguments to the page display.
   */
  public function testViewsOwnTheContextualRoutes(): void {
    foreach (['project' => $this->projectA, 'team' => $this->teamA] as $kind => $entity) {
      $display = $kind . '_tickets';
      $this->enterRoute('view.tickets.' . $display, 'bb_' . $kind, $entity);
      $route_match = $this->container->get('current_route_match');
      self::assertSame(
        'Drupal\\views\\Routing\\ViewPageController::handle',
        $route_match->getRouteObject()->getDefault('_controller'),
      );
      $build = (new ViewPageController())->handle('tickets', $display, $route_match);
      self::assertIsArray($build);
      self::assertSame(['workspace-a', (string) $entity->id()], $build['#arguments']);
    }
  }

  /**
   * Executes a contextual display as the scoped reader.
   *
   * @param string $display
   *   The display id.
   * @param array<int, string> $arguments
   *   The route-owned contextual argument.
   * @param array<string, mixed> $input
   *   Exposed filter input.
   *
   * @return \Drupal\views\ViewExecutable
   *   The executed view.
   */
  private function executeDisplay(string $display, array $arguments, array $input = []): ViewExecutable {
    $arguments = ['workspace-a', ...$arguments];
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    try {
      $view = Views::getView('tickets');
      self::assertInstanceOf(ViewExecutable::class, $view);
      self::assertTrue($view->setDisplay($display));
      $view->override_url = Url::fromRoute('view.tickets.my_work', ['bb_workspace' => 'workspace-a']);
      $view->setArguments($arguments);
      $view->setExposedInput($input);
      $view->get_total_rows = TRUE;
      $view->preExecute($arguments);
      $view->execute($display);
      return $view;
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Renders the display with the scoped reader's field access.
   */
  private function rendered(string $display, array $arguments, array $input = []): string {
    $arguments = ['workspace-a', ...$arguments];
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    try {
      $view = Views::getView('tickets');
      self::assertInstanceOf(ViewExecutable::class, $view);
      self::assertTrue($view->setDisplay($display));
      $view->override_url = Url::fromRoute('view.tickets.my_work', ['bb_workspace' => 'workspace-a']);
      $view->setArguments($arguments);
      $view->setExposedInput($input);
      $build = $view->render($display);
      self::assertIsArray($build);
      return (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Returns ticket entity ids from a real Search API Views result.
   *
   * @return array<int>
   *   Sorted ticket ids.
   */
  private function ticketIds(string $display, array $arguments, array $input = []): array {
    $ids = [];
    foreach ($this->executeDisplay($display, $arguments, $input)->result as $row) {
      /** @var \Drupal\search_api\Plugin\views\ResultRow $row */
      $object = $row->_object ?? NULL;
      $ticket = $object instanceof ComplexDataInterface ? $object->getValue() : NULL;
      if ($ticket instanceof BbTicketInterface) {
        $ids[] = (int) $ticket->id();
      }
    }
    sort($ids);
    return $ids;
  }

  /**
   * Indexes the pending tickets against the current relation data.
   */
  private function backfillTicketIndex(): void {
    Index::load('bb_tickets')?->indexItems(-1, 'entity:bb_ticket');
  }

  /**
   * Stages an actual route match for the Views page controller.
   *
   * @param string $route_name
   *   The route name.
   * @param string $parameter_name
   *   The entity parameter name.
   * @param \Drupal\Core\Entity\ContentEntityInterface $entity
   *   The route entity.
   */
  private function enterRoute(string $route_name, string $parameter_name, ContentEntityInterface $entity): void {
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $request = Request::create($route->getPath());
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set($parameter_name, $entity);
    $request->attributes->set('bb_workspace', $this->fixture('a', 'bb_workspace'));
    $request->attributes->set('_raw_variables', new ParameterBag([
      'bb_workspace' => 'workspace-a',
      $parameter_name => (string) $entity->id(),
    ]));
    $this->container->get('request_stack')->push($request);
  }

}
