<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\views\Entity\View;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;

/**
 * The tickets view is core's table over ten fields, and exposes ten facets.
 *
 * WHAT THIS FILE ASSERTS AND WHAT IT DELIBERATELY DOES NOT. It asserts the
 * CONFIG: which style runs, which ten fields in which order, which formatter
 * each column carries, which columns are exposed as facets. It asserts nothing
 * about the rendered result, because spec R9 is explicit that "the presence of
 * nine fields is what config already guarantees" — the rendered cell values are
 * `TicketsViewTableTest`'s subject, through the real view and the real
 * template.
 */
#[Group('bb_core')]
final class TicketsViewConfigTest extends KernelTestBase {

  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * The plan's list was `system`, `user`, `views`, `search_api`, `bb_core`,
   * and it does not boot: `bb_core.workspace_read_scope` depends on
   * `og.membership_manager`, so `og` and the field modules it needs have to be
   * present even though this test only reads config entities. The view's own
   * `dependencies.module` adds `better_exposed_filters` and
   * `facets_exposed_filters`; without them the optional config installer
   * refuses the view, and `search_api_db` carries the server the index needs.
   * `facets` itself is required too, because the exposed-filter handler asks
   * the container for `plugin.manager.facets.query_type` while the view is
   * being saved.
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'og', 'state_machine', 'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    // `views_filters_summary` states the chosen facets above the rows
    // (BB-413, 2026-09-04) and the view names it in
    // `dependencies.module`, so the optional config installer refuses the
    // view without it — the symptom is "The tickets view is not installed".
    'views_filters_summary',
    'ui_patterns',
    // `display_builder_views` ships the SCHEMA for the page display's
    // `display_builder` extender (BB-413, 2026-09-04). Without the module
    // `views.view.tickets` will not INSTALL at all: `ConfigSchemaChecker`
    // rejects `display_extenders.display_builder` as "missing schema", and
    // strict config schema is on by default in every Kernel test.
    'display_builder', 'ui_patterns_views', 'display_builder_views',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   *
   * Installs bb_core's optional config, which is where this view lives. A
   * Kernel test's `installConfig()` reads `config/install` only, so the
   * two-path copy under `config/optional` has to be asked for by name — the
   * same call T3's index test makes, and it is deliberately the module copy
   * rather than `config/sync`: the CIM store is not on any test's path, so a
   * copy that drifted from `config/sync` would still pass here.
   */
  protected function setUp(): void {
    parent::setUp();
    // Saving a server runs search_api's ServerTaskManager, which queries the
    // search_api_task entity, and the index's tracker enumerates its
    // datasource, so the indexed entity's own table has to exist too.
    $this->installEntitySchema('search_api_task');
    $this->installEntitySchema('bb_ticket');
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install the recipe copy.
    $this->installShippedView('views.view.tickets');
  }

  /**
   * The seven facets this ticket delivers.
   *
   * `team` is not among them: the bb_project.teams edge does not exist and
   * BB-356 owns whether it should.
   */
  private const FACETS = [
    'group', 'project', 'team', 'state', 'workflow', 'assignee', 'owner', 'priority', 'label', 'closed',
    // Tickets generated from a ticket template.
    'template',
    // The title search, which the search-and-sort toolbar prints.
    'title',
  ];

  /**
   * The rendered display's options, with the default display's underneath.
   *
   * A PAGE DISPLAY, AND THE THIRD ANSWER TO THAT QUESTION. T9 exported a page
   * one; T10 replaced it with a block, because a Views page display registers a
   * route and `PathPluginBase::alterRoutes()` resolved a same-path collision by
   * taking the existing route OVER. On 2026-09-04 the human reversed it a third
   * time — *"use a view route and have the canvas rendered inside/around the
   * view"* — so the page display is back, `BbTicketListController` and the
   * `bb_core.tickets` route are deleted, and there is no collision left to
   * resolve. `TicketListRouteTest` guards that exactly one route claims the
   * path.
   *
   * @return array<string, mixed>
   *   The merged display options.
   */
  private function display(): array {
    $view = View::load('tickets');
    self::assertNotNull($view, 'The tickets view is missing.');
    return $view->getDisplay('page_1')['display_options']
      + $view->getDisplay('default')['display_options'];
  }

  /**
   * The page display claims the nav home, with a NAMED placeholder.
   *
   * THE NAME IS THE WHOLE ASSERTION, and a bare `%` would satisfy a check that
   * only looked for a path. `PathPluginBase::getRoute()` turns `%` into
   * `{arg_0}` and `%x` into `{x}` with `_view_argument_map[arg_0] = 'x'`. Only
   * the named form gives the route the `{bb_workspace}` slot that
   * `BbWorkspaceRouteSubscriber` treats by path — converter, slug pattern,
   * `_bb_workspace_match`, `_admin_route: FALSE` — and only the map puts the
   * slug into `$view->args`, without which the exposed form asks
   * `$view->getUrl()`, gets the wildcard and throws against the slug
   * requirement: HTTP 500, measured.
   */
  public function testThePageDisplayClaimsTheNavHomeByName(): void {
    self::assertSame(
      '_workspace/%bb_workspace/tickets/all',
      $this->display()['path'],
      'The full find-a-ticket table moved down one segment on 2026-09-04.',
    );
    self::assertSame(
      '_workspace/%bb_workspace/tickets',
      View::load('tickets')->getDisplay('my_work')['display_options']['path'],
      'The nav home is the SCOPED display now, and it keeps the named placeholder.',
    );
  }

  /**
   * Exactly two displays of this view are routed, at two different paths.
   *
   * IT WAS ONE UNTIL 2026-09-04, AND THE PAIR IS THE POINT NOW. The danger a
   * single-display assertion guarded against has not gone away — two page
   * displays at ONE path is a collision `PathPluginBase::alterRoutes()`
   * resolves silently by keeping the existing route — so the assertion moves
   * from "there is one" to "there are two and their paths differ", the property
   * that actually has to hold. `TicketListRouteTest` reads the same fact off
   * the built router.
   */
  public function testBothDisplaysAreRoutedAtDifferentPaths(): void {
    $view = View::load('tickets');
    self::assertNotNull($view);
    $routed = [];
    foreach ($view->get('display') as $id => $display) {
      if (array_key_exists('path', $display['display_options'])) {
        $routed[$id] = $display['display_options']['path'];
      }
    }
    ksort($routed);

    self::assertSame(
      [
        'my_work' => '_workspace/%bb_workspace/tickets',
        'page_1' => '_workspace/%bb_workspace/tickets/all',
        'project_tickets' => '_workspace/%bb_workspace/project/%bb_project/tickets',
        'team_tickets' => '_workspace/%bb_workspace/team/%bb_team/tickets',
      ],
      $routed,
      'Two routed displays at one path would put two routes there, decided by route fit.',
    );
  }

  /**
   * The style is the shared `bb_list`, with the approved ticket pattern.
   */
  public function testTheStyleIsTheSharedListWithTheTicketPattern(): void {
    $style = $this->display()['style'];
    self::assertSame('bb_list', $style['type']);
    self::assertSame([
      'avatar' => ['state'],
      'headline' => ['title', 'priority'],
      'meta' => ['identifier', 'created', 'owner', 'conductor', 'stall_reason', 'run_count'],
      'right' => ['assignee'],
    ], $style['options']['pattern']);
  }

  /**
   * The ten fields are real Views FIELDS, in row order.
   *
   * The field ids ARE the cell keys the pattern and the Designbook entity
   * mapping address. Project and team left the row: both repeat context the
   * listing already has, and both stay available as filters.
   */
  public function testTheTenFieldsAreThePatternsOwn(): void {
    $fields = $this->display()['fields'];
    self::assertSame(
      [
        'state',
        'title',
        'priority',
        'identifier',
        'created',
        'owner',
        'conductor',
        'stall_reason',
        'run_count',
        'assignee',
      ],
      array_keys($fields),
    );
    self::assertSame(['created', 'Created'], [$fields['created']['field'], $fields['created']['label']]);
    self::assertSame(['owner_user_id', 'by'], [$fields['owner']['field'], $fields['owner']['label']]);
  }

  /**
   * Each field renders itself, through a formatter of its own.
   */
  public function testEveryFieldCarriesTheFormatterItsFaceNeeds(): void {
    $fields = $this->display()['fields'];

    foreach ([
      'identifier' => 'bb_ticket_identifier_cell',
      'title' => 'string',
      'state' => 'bb_ticket_state_icon_cell',
      'priority' => 'bb_ticket_priority_cell',
      'created' => 'bb_time',
      'owner' => 'bb_ticket_owner_cell',
      'assignee' => 'bb_ticket_assignee_avatar_cell',
      'conductor' => 'bb_ticket_conductor_cell',
    ] as $key => $formatter) {
      self::assertSame($formatter, $fields[$key]['type'] ?? NULL, sprintf('Field %s.', $key));
    }
    self::assertSame('bb_reference_count', $fields['run_count']['plugin_id'] ?? NULL);
    self::assertSame('bb_stall_reason', $fields['stall_reason']['plugin_id'] ?? NULL);
  }

  /**
   * The exposed sorts are the spec's, defaulting to Updated, newest first.
   *
   * The unexposed tie-breaker comes last, so equal primary values keep a
   * stable order across pages; it follows the chosen direction.
   */
  public function testTheExposedSortsAndTheTieBreaker(): void {
    $sorts = $this->display()['sorts'];
    self::assertSame(['changed', 'identifier', 'state', 'priority', 'bb_tie_breaker'], array_keys($sorts));
    self::assertSame('DESC', $sorts['changed']['order']);
    foreach (['changed', 'identifier', 'state', 'priority'] as $key) {
      self::assertTrue($sorts[$key]['exposed'], sprintf('Sort %s is exposed.', $key));
    }
    self::assertFalse($sorts['bb_tie_breaker']['exposed']);
    self::assertSame('bb_tie_breaker', $sorts['bb_tie_breaker']['plugin_id']);

    $sort_widget = $this->display()['exposed_form']['options']['bef']['sort'];
    self::assertTrue($sort_widget['advanced']['combine']);
    self::assertStringContainsString('Updated Desc|Updated, newest first', $sort_widget['advanced']['combine_rewrite']);
  }

  /**
   * There is no row plugin: the style renders the whole result set.
   */
  public function testThereIsNoRowPlugin(): void {
    self::assertArrayNotHasKey('row', $this->display());
  }

  /**
   * The exposed filters, keyed by the identifier they carry in the URL.
   *
   * The plan keyed these assertions on the `filters` array key, which is the
   * Views handler id and is not settable: Views derives it from the indexed
   * field, so the seven arrive as `facets_group_id`, `facets_labels` and so
   * on. Keying on the handler id would also make the two absence assertions
   * below vacuous — no handler is ever called `team` or `workspace_id`. The
   * EXPOSED IDENTIFIER is the load-bearing name: it is what the boosted GET
   * puts in the query string, which is the whole of criterion 5.
   *
   * @return array<string, array<string, mixed>>
   *   Each exposed filter, keyed by its exposed identifier.
   */
  private function facetsByIdentifier(): array {
    $by_identifier = [];
    foreach ($this->display()['filters'] as $handler_id => $filter) {
      $identifier = $filter['expose']['identifier'] ?? $handler_id;
      $by_identifier[$identifier] = $filter;
    }
    return $by_identifier;
  }

  /**
   * The global display exposes the complete ten-facet vocabulary.
   *
   * `closed` joined the eight BB-420 named (BB-490): the rearchitecture
   * from a non-exposed source into an exposed filter with its own widget
   * puts it in this same vocabulary, keyed by its exposed identifier like
   * every other facet. `owner` joined that set (BB-416): the ticket's
   * creator is filterable the same way its assignee already was.
   */
  public function testTheTenFacetsAreExposed(): void {
    $filters = $this->facetsByIdentifier();

    foreach (self::FACETS as $facet) {
      self::assertArrayHasKey($facet, $filters, sprintf('Facet %s is missing.', $facet));
      self::assertNotEmpty($filters[$facet]['exposed'], sprintf('Facet %s is not exposed.', $facet));
    }
    self::assertArrayHasKey('team', $filters, 'team must come from project_team_ids.');
    self::assertCount(count(self::FACETS), $filters, 'The display carries a filter this ticket does not deliver.');
  }

  /**
   * Every exposed facet uses the same BEF widget, single or multiple.
   *
   * `expose.multiple` is what chooses radio against checkbox inside the
   * picker. A facet missing from the BEF map falls back to a native select,
   * which is a second widget on the same form.
   */
  public function testEveryExposedFacetUsesTheOptionPickerWidget(): void {
    $bef = $this->display()['exposed_form']['options']['bef']['filter'] ?? [];
    foreach ($this->display()['filters'] as $id => $filter) {
      if (($filter['plugin_id'] ?? '') !== 'facets_filter') {
        continue;
      }
      if (empty($filter['exposed'])) {
        continue;
      }
      self::assertSame(
        'bb_option_picker',
        $bef[$id]['plugin_id'] ?? NULL,
        $id . ' must use the option picker, not a second widget.',
      );
    }
  }

  /**
   * Contextual displays share the default table but own exact route filters.
   */
  public function testContextualDisplaysUseTheExactFilterMatrices(): void {
    $view = View::load('tickets');
    self::assertNotNull($view);

    $expected = [
      'project_tickets' => [
        'argument_field' => 'project_id',
        'hidden' => 'project',
        'filters' => [
          'title', 'closed', 'state', 'workflow', 'assignee', 'owner', 'priority', 'label',
        ],
      ],
      'team_tickets' => [
        'argument_field' => 'project_team_ids',
        'hidden' => 'team',
        'filters' => [
          'title', 'closed', 'group', 'project', 'template', 'state', 'workflow', 'assignee', 'owner', 'priority', 'label',
        ],
      ],
    ];

    foreach ($expected as $display_id => $contract) {
      $display = $view->getDisplay($display_id);
      self::assertSame('page', $display['display_plugin'], $display_id);
      self::assertArrayHasKey('path', $display['display_options'], $display_id);
      self::assertSame(
        ['null', $contract['argument_field']],
        array_keys($display['display_options']['arguments']),
        $display_id . ' has one required route argument.',
      );
      self::assertSame(
        'access denied',
        $display['display_options']['arguments'][$contract['argument_field']]['default_action'],
        $display_id . ' must fail closed without its route context.',
      );
      self::assertSame(
        '',
        $display['display_options']['arguments'][$contract['argument_field']]['exception']['value'] ?? NULL,
        $display_id . ' must not turn a missing context into an all-values query.',
      );
      self::assertFalse(
        $display['display_options']['defaults']['empty'] ?? TRUE,
        $display_id . ' must use the contextual empty-state handler.',
      );

      $filters = [];
      foreach ($display['display_options']['filters'] as $filter) {
        $identifier = $filter['expose']['identifier'] ?? NULL;
        if ($identifier !== NULL && ($filter['exposed'] ?? FALSE)) {
          $filters[] = $identifier;
        }
      }
      self::assertSame($contract['filters'], $filters, $display_id . ' filter matrix, in form order.');

      $hidden = $display['display_options']['filters'];
      $hidden = array_filter(
        $hidden,
        static fn(array $filter): bool => ($filter['expose']['identifier'] ?? NULL) === $contract['hidden'],
      );
      self::assertCount(1, $hidden, $display_id . ' keeps its context selector hidden.');
      self::assertFalse((bool) reset($hidden)['exposed']);

      $expected_processors = [
        'assignee' => ['uid_to_username_callback'],
        'owner' => ['uid_to_username_callback'],
        'group' => ['translate_entity'],
        'label' => ['translate_entity'],
        'priority' => ['list_item'],
        'project' => ['translate_entity'],
        'state' => ['bb_ticket_state_label'],
        'team' => ['translate_entity'],
        'workflow' => ['list_item'],
      ];
      foreach ($display['display_options']['filters'] as $filter) {
        $identifier = $filter['expose']['identifier'] ?? NULL;
        if ($identifier !== NULL && isset($expected_processors[$identifier])) {
          self::assertSame(
            $expected_processors[$identifier],
            array_keys($filter['facet']['processor_configs'] ?? []),
            $display_id . ' ' . $identifier . ' facet processors.',
          );
        }
      }
    }
  }

  /**
   * My work drops the assignee facet its current-user predicate already fixes.
   */
  public function testMyWorkExposesTheExactFilterMatrixInOrder(): void {
    $filters = View::load('tickets')->getDisplay('my_work')['display_options']['filters'];
    $exposed = [];
    foreach ($filters as $filter) {
      if (!empty($filter['exposed'])) {
        $exposed[] = $filter['expose']['identifier'];
      }
    }

    self::assertSame(
      ['title', 'closed', 'group', 'project', 'template', 'state', 'workflow', 'owner', 'priority', 'label'],
      $exposed,
    );
    self::assertFalse($filters['bb_assignee_is_current_user']['exposed']);
    self::assertSame('bb_search_api_current_user', $filters['bb_assignee_is_current_user']['plugin_id']);
  }

  /**
   * The workspace scopes the screen; it is not a filter on it.
   */
  public function testThereIsNoWorkspaceFacet(): void {
    $filters = $this->facetsByIdentifier();
    foreach (['workspace', 'workspace_id'] as $identifier) {
      self::assertArrayNotHasKey(
        $identifier,
        $filters,
        'The workspace switches globally in the shell; filtering by it would narrow what already scopes the screen.',
      );
    }
  }

  /**
   * The exposed form is renderable on its own, for the canvas slot.
   */
  public function testTheExposedFormIsNotDivertedToBlock(): void {
    // REVERSED ON 2026-09-04, and it is the opposite of what F8 concluded.
    // While a controller composed the canvas, `exposed_block: true` plus
    // `renderExposedForm($block = TRUE)` was the supported way to put the form
    // somewhere other than above the table. With the canvas composed INSIDE the
    // view by the display builder, the option is what breaks it:
    // `ExposedFormPluginBase::renderExposedForm($block = FALSE)` returns `[]`
    // whenever it is set, on both the `build()` pass and facets' post-execute
    // rebuild, so the `view_exposed` source has nothing to place and the aside
    // renders empty — measured on the live surface as 0 forms and 0 facet
    // panels, with no error anywhere.
    //
    // Placing the `views_exposed_filter_block` in the slot instead is worse
    // than empty: that block builds its OWN ViewExecutable with no route
    // arguments, so `ViewsExposedForm` asks `$view->getUrl()`, Views
    // substitutes the wildcard for `{bb_workspace}`, and the slug requirement
    // rejects it — `InvalidParameterException`, HTTP 500, measured.
    self::assertFalse(
      (bool) ($this->display()['exposed_block'] ?? FALSE),
      'exposed_block leaves the in-view exposed form empty, silently.',
    );
  }

  /**
   * The view reads the index, so the facets have something to hang on.
   */
  public function testItQueriesTheIndexAndNotTheTable(): void {
    self::assertSame(
      'search_api_index_bb_tickets',
      View::load('tickets')->get('base_table'),
    );
  }

  /**
   * The `none` access plugin is delegation, and the delegates are asserted too.
   *
   * THE THREE CLAUSES ARE ONE ASSERTION ON PURPOSE. A reader who greps this
   * config for `access:` finds `none` on the default display, and a views YAML
   * can carry no comment to answer them — so the answer is here, where somebody
   * worried about `none` will look. The screen is protected three other ways
   * and none of them is a views access plugin:
   *
   * - THE ROUTE. `/{workspace}/tickets` is workspace-prefixed; reaching the
   *   display at all means upcasting `{bb_workspace}` and passing the
   *   workspace route treatment. There is no unscoped address for it, which is
   *   what `testThePageDisplayClaimsTheNavHomeByName()` already pins.
   * - `BbReadScope` ON THE INDEX. The display queries the Search API index
   *   (see the case above), so the `entity` module's `ViewsQueryAlter` — typed
   *   on the SQL query plugin — never fires. The processor re-applies
   *   `entity.query_access.bb_ticket` to the Search API query and fails
   *   closed. `TicketIndexReadScopeTest` asserts that from the outsider's side.
   * - SEARCH API'S PER-ITEM CHECK, which is the pair of query options asserted
   *   below: with either flipped, results stop being access-checked as
   *   entities and `none` really would mean none.
   *
   * A views `perm` or `role` plugin on top of those would be a FOURTH rule with
   * a fourth vocabulary, and the first to drift would be the one nobody
   * re-derived from the query-access layer — the failure AC 8 names outright.
   * Asserting the delegation and its delegates together is what stops the
   * removal of a real protection reading as the intended delegation.
   */
  public function testTheDisplayDelegatesAccessRatherThanRestatingIt(): void {
    $display = $this->display();

    self::assertSame(
      'none',
      $display['access']['type'] ?? NULL,
      'The display grew an access rule of its own; see the docblock.',
    );

    $query = $display['query']['options'] ?? [];
    self::assertFalse(
      $query['bypass_access'] ?? TRUE,
      'bypass_access drops search_api\'s per-item entity access check.',
    );
    self::assertFalse(
      $query['skip_access'] ?? TRUE,
      'skip_access drops search_api\'s per-item entity access check.',
    );
  }

  /**
   * My work is the default menu tab, and it owns those settings itself.
   *
   * THIS IS THE COUNTERWEIGHT TO A SCHEMA REPAIR, and it is asserted through
   * `getOption()` rather than off the YAML because `getOption()` is the only
   * place the question is actually decided. BB-481 first expressed this tab
   * row with `defaults.menu: false` and `defaults.tab_options: false` beside
   * the display's own `menu` block, and those two keys are unschematisable:
   * core types `defaults` as a CLOSED mapping of 28 keys
   * (`views.data_types.schema.yml`) and neither is among them, so every Kernel
   * test with `$strictConfigSchema` that installs this view raised — 98 errors
   * across eleven classes in the CI `phpunit` job.
   * `TicketsViewShippedSchemaTest` is the millisecond guard on that.
   *
   * REMOVING THEM IS PROVABLY INERT, which is why this assertion can exist at
   * all rather than the repair having to invent a different mechanism.
   * `DisplayPluginBase::isDefaulted()` reads
   * `!empty($this->options['defaults'][$option])`, and `empty(FALSE)` and
   * `empty(NULL)` are both TRUE — so the key present-and-false and the key
   * absent select the SAME branch, the display's own option. The keys were
   * inert to begin with: `menu` and `tab_options` are defined by
   * `Page::defineOptions()` alone, appear in neither
   * `DisplayPluginBase::defaultableSections()` nor the `defaults` option's own
   * default array, and so were never overridable across displays. Views UI
   * would not have written them.
   *
   * WHAT THIS THEREFORE PINS is the thing the repair could have cost: the tab
   * row itself. `default tab` is what makes `/{workspace}/tickets` the tab the
   * page opens on, `tab_options.type: none` is what stops Views inventing a
   * parent item beside the local tasks `bb_core.links.task.yml` declares,
   * and the Stats task hangs off this display's task. Delete the `menu` block
   * to satisfy a schema and the row silently becomes one unmarked page — which
   * is exactly the risk the review recorded against this repair.
   */
  public function testMyWorkIsTheDefaultMenuTabOnItsOwnSettings(): void {
    $view = Views::getView('tickets');
    self::assertNotNull($view, 'views.view.tickets is not installed.');
    $view->setDisplay('my_work');
    $display = $view->display_handler;

    self::assertFalse(
      $display->isDefaulted('menu'),
      'The menu settings are inherited from the default display, which is not a page and has none.',
    );
    self::assertFalse(
      $display->isDefaulted('tab_options'),
      'The tab options are inherited from the default display, which is not a page and has none.',
    );

    $menu = $display->getOption('menu');
    self::assertSame(
      'default tab',
      $menu['type'] ?? NULL,
      'Without `default tab` My work is an ordinary page and the Stats task has nothing to hang off.',
    );
    self::assertSame(
      'Tickets',
      $menu['title'] ?? NULL,
      'The tab the page opens on is titled Tickets.',
    );
    self::assertSame(
      'none',
      $display->getOption('tab_options')['type'] ?? NULL,
      'A parent item here would sit beside the tasks bb_core.links.task.yml declares.',
    );
    self::assertSame(
      '_workspace/%bb_workspace/tickets',
      $display->getOption('path'),
      'The page nobody wanted moved must not move.',
    );
  }

}
