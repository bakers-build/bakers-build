<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\search_api\Entity\Index;
use Drupal\user\UserInterface;
use Drupal\views\Entity\View;
use Drupal\views\Views;
use Symfony\Component\Yaml\Yaml;
use PHPUnit\Framework\Attributes\Group;

/**
 * My work is a DISPLAY of the tickets view, not a pre-selected facet set.
 *
 * THE HUMAN'S DECISION OF 2026-09-04, STATED TWICE. A filtered variant of the
 * ticket list is a Views display with real filters, not the same display
 * reached with facet defaults chosen for the reader. Two reasons the decision
 * carries, and both are observable here rather than matters of taste:
 *
 *   - A DEFAULT IS A THING THE READER CAN REMOVE. A facet default renders as a
 *     chosen chip with a dismiss link, so "my work" would be one click away
 *     from being the whole list while the address, the rail's current entry and
 *     the screen's title all still said My work. A display's own filters are
 *     not exposed and carry no chip, so the narrowing is a property of the
 *     screen.
 *   - THE FACETS MUST STILL WORK ON TOP. Both displays keep the option-picker
 *     facets, and on `my_work` they narrow the scoped list rather than
 *     replacing it.
 *
 * AND EVERY PATH STAYS UNDER THE WORKSPACE PREFIX, which is the second half of
 * the same decision. `my_work` takes `/{workspace}/tickets` — the nav home, the
 * address the rail's My work entry generates — and the full find-a-ticket table
 * moves to `/{workspace}/tickets/all`. Neither is reachable without a
 * workspace, so neither can leak one.
 *
 * `assignee = me` IS A FILTER PLUGIN AND NOT A VIEWS ARGUMENT, and that is a
 * measured constraint rather than a preference. Views' own route for "the
 * current user" is an argument with `default_argument_type: user`, and this
 * path cannot use it: `PathPluginBase::getRoute()` maps `%bb_workspace` onto
 * argument position 0 (`_view_argument_map[arg_0] = 'bb_workspace'`), so
 * `ViewPageController::handle()` would hand the workspace SLUG to the first
 * declared argument. The first argument is already taken by the path.
 *
 * NON-TERMINAL IS DERIVED, NOT RESTATED.
 * `TypeWorkflows::terminalTicketStates()` returns terminal states PER WORKFLOW,
 * because terminality is a per-workflow property — a state is terminal in a
 * workflow when no transition of that
 * workflow lists it in a `from` set. The filter builds one condition group per
 * workflow rather than a flat union, so a workflow that later gains a
 * transition out of `done` keeps its `done` rows on this screen without a
 * config edit. A `state NOT IN (done, cancelled)` filter in the view's YAML
 * would be the same list typed a second time, in a place nothing recomputes.
 */
#[Group('bb_core')]
final class TicketMyWorkDisplayTest extends KernelTestBase {

  use UserCreationTrait;
  use ProjectsViewTestTrait;

  /**
   * The workspace slug every render in this file is made against.
   */
  private const WORKSPACE_SLUG = 'bakers';

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
    'views_filters_summary',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views', 'bb_core',
  ];

  /**
   * The account whose work `my_work` is, in this fixture.
   */
  private UserInterface $me;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_project',
      'bb_ticket', 'bb_run', 'bb_term', 'search_api_task',
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['user', 'search_api', 'views']);
    $this->enableTheShippedDisplayExtender();
    BbVocabulary::create(['id' => 'label', 'label' => 'bakers.build labels'])->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'display_builder']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install the recipe copy.
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    $this->seed();
  }

  /**
   * The two displays sit at the two paths, both under the workspace prefix.
   */
  public function testTheTwoDisplaysAreAtTheirTwoPaths(): void {
    self::assertSame(
      '_workspace/%bb_workspace/tickets',
      $this->options('my_work')['path'],
      'My work is the nav home, so it takes the bare path.',
    );
    self::assertSame(
      '_workspace/%bb_workspace/tickets/all',
      $this->options('page_1')['path'],
      'The full find-a-ticket table moves down one segment.',
    );
  }

  /**
   * Both displays are routed, and each route is under the prefix.
   *
   * The pair is asserted rather than each alone, because the failure mode of
   * two page displays is a same-path collision: `PathPluginBase::alterRoutes()`
   * resolves one by taking the EXISTING route over, silently.
   */
  public function testBothRoutesExistAndNeitherCollides(): void {
    $provider = $this->container->get('router.route_provider');

    self::assertSame(
      '/_workspace/{bb_workspace}/tickets',
      $provider->getRouteByName('view.tickets.my_work')->getPath(),
    );
    self::assertSame(
      '/_workspace/{bb_workspace}/tickets/all',
      $provider->getRouteByName('view.tickets.page_1')->getPath(),
    );
    foreach (['tickets', 'tickets/all'] as $tail) {
      $names = array_keys($provider
        ->getRoutesByPattern('/_workspace/{bb_workspace}/' . $tail)
        ->all());
      self::assertCount(
        1,
        $names,
        'Exactly one route may claim /' . $tail . '; it claims ' . implode(', ', $names),
      );
    }
  }

  /**
   * My work shows my open tickets and nothing else.
   *
   * FOUR ROWS EXIST AND ONE OF THEM IS MINE AND OPEN. The three that are not
   * fail the filter for three different reasons — terminal, someone else's,
   * nobody's — so a filter that dropped only one of the three conditions is
   * still caught.
   */
  public function testMyWorkListsOnlyMyNonTerminalTickets(): void {
    $html = $this->screen('my_work');

    self::assertSame(
      1,
      substr_count($html, 'data-list-item'),
      'One of the four seeded tickets is mine and open.',
    );
    self::assertStringContainsString('Mine and open', $html);
    self::assertStringNotContainsString(
      'Mine and done',
      $html,
      'A terminal ticket is not work.',
    );
    self::assertStringNotContainsString(
      'Somebody else and open',
      $html,
      'Another member\'s ticket is not my work.',
    );
    self::assertStringNotContainsString(
      'Nobody and open',
      $html,
      'An unassigned ticket is nobody\'s work, so it is not mine.',
    );
  }

  /**
   * The full list shows all four once the closed control is set to All.
   *
   * BB-490 gave `page_1`, like every other listing, `bb_closed_rows`,
   * which hides closed rows by DEFAULT — so the find-a-ticket table only
   * shows every seeded ticket once the request asks for `closed=all`, the
   * same way a reader would by moving the segmented control's third
   * position. Without this the scoped assertion above would also pass on a
   * broken index, an over-tight read scope or a fixture that never got
   * saved.
   */
  public function testTheFullListStillShowsEveryTicket(): void {
    self::assertSame(
      4,
      substr_count($this->screen('page_1', ['closed' => 'all']), 'data-list-item'),
      'Everything the reader may see is on the find-a-ticket table.',
    );
  }

  /**
   * The open/closed narrowing is BB-490's shared `bb_closed_rows` filter.
   *
   * BB-490 replaced `my_work`'s own `bb_non_terminal_ticket_state` filter
   * with the same `bb_closed_rows` filter the other listings carry, so the
   * open/closed narrowing now follows the request's `closed` parameter rather
   * than restating a state list; see `ConfigCopyDriftTest::
   * testMyWorkNoLongerFiltersOnTerminalState()` for the config-level half of
   * this assertion.
   */
  public function testTheTerminalStatesAreDerivedAndNotRestated(): void {
    $filters = $this->options('my_work')['filters'];

    self::assertSame(
      'bb_closed_rows',
      $filters['bb_closed_rows']['plugin_id'] ?? NULL,
      'my_work must share the closed control\'s filter with the other listings.',
    );
    self::assertArrayNotHasKey(
      'bb_ticket_is_open',
      $filters,
      'BB-490 replaced the state-derived filter with bb_closed_rows.',
    );
    self::assertSame(
      'bb_search_api_current_user',
      $filters['bb_assignee_is_current_user']['plugin_id'] ?? NULL,
      'The assignee filter has to be the one that reads the view\'s account.',
    );

    $exported = Yaml::dump(View::load('tickets')->get('display')['my_work']);
    foreach (['done', 'cancelled'] as $state) {
      self::assertStringNotContainsString(
        $state,
        $exported,
        'The my_work display must not name a terminal state; TypeWorkflows owns the list.',
      );
    }
  }

  /**
   * The assignee scope grows no chip; the closed control is not a chip either.
   *
   * `bb_assignee_is_current_user` stays non-exposed: a chip carries a
   * dismiss link, so an exposed `my_work` filter would be one click away from
   * being the whole list under a screen still calling itself My work.
   * `bb_closed_rows` is exposed (BB-490) — the operator does choose that
   * position — but it renders its own segmented control rather than a
   * removable chip, and `hook_views_filters_summary_info_alter()` excludes it
   * from the chip summary explicitly, so the assertion below still holds.
   */
  public function testNeitherScopingFilterIsExposedOrRemovable(): void {
    $filters = $this->options('my_work')['filters'];

    self::assertFalse(
      (bool) ($filters['bb_assignee_is_current_user']['exposed'] ?? FALSE),
      'bb_assignee_is_current_user must not be exposed, or the reader can remove the scope.',
    );
    self::assertTrue(
      (bool) ($filters['bb_closed_rows']['exposed'] ?? FALSE),
      'bb_closed_rows is exposed by design (BB-490): its own control, not a removable chip.',
    );
    self::assertStringNotContainsString(
      'data-facet',
      $this->screen('my_work'),
      'The scope is the screen\'s, so it states no chip to undo.',
    );
  }

  /**
   * Both displays keep the canvas, the option-picker facets and the chips.
   *
   * THE TREE IS PER DISPLAY AND IS NOT INHERITED, measured rather than assumed:
   * `display_extenders` is an ordinary display option, so a display that does
   * not declare it falls back to `default`'s — and `default`'s is `{}`. So each
   * page display carries its own `display_builder` tree, and a display added
   * without one renders as a bare Views table with no canvas and no error.
   */
  public function testBothDisplaysCarryTheirOwnCanvasTree(): void {
    foreach (['my_work', 'page_1'] as $display_id) {
      $tree = Yaml::dump(View::load('tickets')
        ->getDisplay($display_id)['display_options']['display_extenders'] ?? []);
      foreach ([
        'bb_theme:canvas',
        'bb_theme:filters',
        'bb_theme:active-filters',
        'view_exposed',
        'view_header',
        'view_rows',
        'view_pager',
      ] as $needle) {
        self::assertStringContainsString(
          $needle,
          $tree,
          $display_id . ' has to declare ' . $needle . ' itself; the tree is not inherited.',
        );
      }

      $html = $this->screen($display_id);
      self::assertStringContainsString('data-canvas-region="filters"', $html);
      // my_work has no Team filter (the list is not team-scoped, and Team is
      // on the full listing) and no Assignee filter (the current-user
      // predicate fixes it). page_1 exposes both through the same picker.
      $pickers = $display_id === 'page_1' ? 10 : 8;
      self::assertSame(
        $pickers,
        substr_count($html, 'data-option-picker-trigger'),
        $display_id . ' offers its facets as option pickers.',
      );
      self::assertSame(
        1,
        substr_count($html, 'data-component-id="bb_theme:active-filters"'),
        $display_id . ' states its chips exactly once.',
      );
    }
  }

  /**
   * Each display states its OWN unfiltered word.
   *
   * They mean different things. `All tickets` over `my_work` would be false:
   * that list is narrowed by two filters the reader cannot see. The word lives
   * on the outer `active-filters` node of each display's own tree, which is
   * what makes per-display wording possible at all — the theme's
   * `views-filters-summary.html.twig` override is one file for every display
   * and could only ever say one thing.
   */
  public function testEachDisplayStatesItsOwnUnfilteredWord(): void {
    self::assertStringContainsString(
      'My open tickets',
      $this->screen('my_work'),
      'The scoped list must not claim to be all tickets.',
    );
    self::assertStringContainsString(
      'All tickets',
      $this->screen('page_1'),
    );
  }

  /**
   * One display's options, with the default display's underneath.
   *
   * @param string $display_id
   *   The display id.
   *
   * @return array<string, mixed>
   *   The merged display options.
   */
  private function options(string $display_id): array {
    $view = View::load('tickets');
    self::assertNotNull($view, 'The tickets view is not installed.');
    return $view->getDisplay($display_id)['display_options']
      + $view->getDisplay('default')['display_options'];
  }

  /**
   * One display, rendered the way a request renders it.
   *
   * @param string $display_id
   *   The display id.
   * @param array<string, string> $query
   *   Extra query parameters to add to the current request before the
   *   render, such as `closed`, for BB-490's `bb_closed_rows` filter to
   *   read.
   *
   * @return string
   *   The markup.
   */
  private function screen(string $display_id, array $query = []): string {
    $request_stack = $this->container->get('request_stack');
    if ($query !== []) {
      $current = $request_stack->getCurrentRequest();
      $with_query = $current->duplicate($query + $current->query->all());
      $request_stack->push($with_query);
    }
    try {
      $view = Views::getView('tickets');
      self::assertNotNull($view, 'The tickets view is not installed.');
      $build = $view->buildRenderable($display_id, [self::WORKSPACE_SLUG]);

      return (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      if ($query !== []) {
        $request_stack->pop();
      }
    }
  }

  /**
   * Turns the display-builder extender on, from the object the repo ships.
   *
   * The same read `TicketListCanvasTest` performs, and for the same reason: a
   * Kernel test never runs `display_builder_views_install()`, which is the only
   * thing that appends the extender to `views.settings`, so without this the
   * view renders as a bare Views table with no canvas and no error.
   */
  private function enableTheShippedDisplayExtender(): void {
    $file = dirname(__DIR__, 7) . '/config/sync/views.settings.yml';
    self::assertFileExists($file, 'The repository ships views.settings.');
    $shipped = Yaml::parseFile($file);
    self::assertIsArray($shipped);
    self::assertContains('display_builder', $shipped['display_extenders'] ?? []);
    $this->config('views.settings')
      ->set('display_extenders', $shipped['display_extenders'])
      ->save();
  }

  /**
   * Four tickets: one mine and open, and three that miss for three reasons.
   */
  private function seed(): void {
    $me = $this->createUser(['administer bakers', 'view bb_ticket'], 'me');
    self::assertInstanceOf(UserInterface::class, $me);
    $this->me = $me;
    $other = $this->createUser([], 'somebody-else');
    self::assertInstanceOf(UserInterface::class, $other);
    $this->setCurrentUser($this->me);

    $workspace = $this->create('bb_workspace', [
      'name' => 'bakers.build',
      'slug' => self::WORKSPACE_SLUG,
    ]);
    $group = $this->create('bb_group', [
      'name' => 'Platform',
      'workspace_id' => $workspace->id(),
    ]);
    $project = $this->create('bb_project', [
      'name' => 'Wiring',
      'key' => 'wire',
      'group_id' => $group->id(),
    ]);

    foreach ([
      ['Mine and open', 'coding', $this->me->id()],
      ['Mine and done', 'done', $this->me->id()],
      ['Somebody else and open', 'coding', $other->id()],
      ['Nobody and open', 'review', NULL],
    ] as [$title, $state, $assignee]) {
      $values = [
        'title' => $title,
        'state' => $state,
        'workflow' => 'bb_work',
        'priority' => 2,
        'project_id' => $project->id(),
      ];
      if ($assignee !== NULL) {
        $values['assignee_user_id'] = $assignee;
      }
      $this->create('bb_ticket', $values);
    }

    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    self::assertSame(
      4,
      $index->indexItems(),
      'All four tickets must be indexed, or an empty list proves nothing.',
    );
  }

  /**
   * Creates and saves an entity of the given type.
   *
   * @param string $entity_type_id
   *   The entity type id.
   * @param array<string, mixed> $values
   *   The field values.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The saved entity.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

}
