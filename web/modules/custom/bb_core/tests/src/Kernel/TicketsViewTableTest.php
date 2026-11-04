<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\search_api\Entity\Index;
use Drupal\views\ResultRow;
use Drupal\views\ViewExecutable;
use Drupal\views\Views;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\DomCrawler\Crawler;

/**
 * The tickets view renders as patterned `bb_theme:list` rows, end to end.
 *
 * WHY THE WHOLE VIEW AND NOT A PIECE OF IT. Spec R9 is explicit about what has
 * to replace the deleted `TicketTableStyleTest`: "whatever replaces it must
 * assert RENDERED CELL VALUES through the real view and the real template, not
 * the presence of nine fields — the presence of nine fields is what config
 * already guarantees." So this test indexes real tickets, executes the real
 * view and renders the real style template, and every assertion is on markup.
 *
 * WHAT IT GUARDS THAT NOTHING ELSE CAN. The mapping is no longer one PHP object
 * a Kernel test can address end to end; it is spread across the view's config,
 * eight formatter configurations and a Twig template. The one thing that ties
 * them together is this render.
 */
#[Group('bb_core')]
final class TicketsViewTableTest extends KernelTestBase {

  /**
   * The display these assertions render.
   *
   * IT WAS `block_1` UNTIL 2026-09-04. The human deleted the list controller
   * and gave the tickets view its route back, so the view has ONE display that
   * is not `default`: the page display at `_workspace/%bb_workspace/tickets`.
   * A block display that nothing placed went with the controller.
   */
  private const DISPLAY_ID = 'page_1';

  /**
   * The route argument the display is executed with.
   *
   * NOT DECORATION. The page display's path carries a named placeholder, so
   * `ViewExecutable::hasUrl()` is TRUE and `ViewsExposedForm` builds the form
   * action from `$view->getUrl()`. With no arguments Views substitutes `*` for
   * `{bb_workspace}`, the route's slug requirement rejects it, and generating
   * the URL throws `InvalidParameterException`.
   */
  private const WORKSPACE_SLUG = 'bakers';

  use WorkspaceReadScopeTestTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * The view's own `dependencies.module` pulls `better_exposed_filters`,
   * `facets` and `facets_exposed_filters` in — without them the optional
   * config installer refuses the view — and `ui_patterns` is here because its
   * node visitor normalizes props in every SDC template regardless of the
   * caller (spec F3), so a list without it renders in a configuration the site
   * never runs in.
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
   * THEME DEBUG IS ON, AND IT IS THE HARDER CONFIGURATION RATHER THAN A
   * CONVENIENCE. Spec F13's absence signal —
   * `template_preprocess_views_view_table()` appending to a column's `content`
   * only when `trim($field_output) != ''` — is clean only while
   * `twig.config.debug` is FALSE. With it on, `FieldPluginBase::theme()` runs
   * each field through `views-view-field.html.twig` and the theme-debug
   * comments make that `trim()` non-empty for an EMPTY field, so every column
   * arrives with content and a naive em-dash rule renders a blank cell
   * instead. Measured on the live site: an empty `priority` arrives 247 bytes
   * long and strips to 0. Production runs with debug off and produces a strict
   * SUBSET of this markup, so every assertion below holds in both; running the
   * suite this way is what stops the naive rule coming back.
   */
  public function register(ContainerBuilder $container): void {
    parent::register($container);
    $container->setParameter('twig.config', ['debug' => TRUE, 'auto_reload' => NULL, 'cache' => TRUE]);
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('search_api_task');
    // The tracker's own table: without it nothing is ever tracked, and
    // indexItems() answers 0 with no error at all.
    $this->installSchema('search_api', ['search_api_item']);
    $this->installReadScopeEnvironment();
    $this->installConfig(['search_api']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install the recipe copy.
    $this->installShippedView('views.view.tickets');
    // The identifier cell and the row target are both toUrl().
    $this->container->get('router.builder')->rebuild();
    // The template under test lives in the theme, so the theme has to be the
    // one the render is performed with — not merely installed.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    $this->buildTwoWorkspaceWorld();
    // A bare workspace membership resolves to no projects, so the reader has
    // to be a member of the PROJECT too or the view answers nothing and every
    // assertion below is about an empty table.
    $reader = $this->createAccount('table-reader', [
      'view bb_ticket',
      // The project and the conductor cells resolve their label through
      // `view label` access (spec D12), so a reader without these grants would
      // render two empty columns and the em-dash rule's count would be about
      // the grant rather than about the data.
      'view bb_project',
      'register bakers conductor',
      // Run count is access-checked; without this grant every row would
      // count as zero and hide_zero would omit the badge.
      'view bb_run',
    ]);
    // Contributor, not member: the reader owns the conductors, and a ticket's
    // conductor reads as stalled while its owner holds no working rank.
    $this->addMembership($this->fixture('a', 'bb_workspace'), $reader, ['contributor']);
    // BB-462 D4/D7: project visibility now follows team membership, not
    // direct project OG membership, which no longer exists once BB-462
    // Phase 3 deregisters bb_project as an OG group.
    $this->addMembership($this->fixture('a', 'bb_team'), $reader, []);
    $this->reader = $reader;
  }

  /**
   * The account every render below is performed as.
   */
  private UserInterface $reader;

  /**
   * The listing renders as the theme's list, with no table anywhere.
   */
  public function testTheViewRendersThePatternedListAndNoTable(): void {
    $this->ticket(['state' => 'working', 'priority' => 2]);
    $html = $this->renderList($this->executed());

    self::assertStringContainsString('data-component-id="bb_theme:list"', $html);
    self::assertStringNotContainsString('<table', $html);
    self::assertStringNotContainsString('bb_theme:table', $html);
    foreach (['headline', 'meta', 'right'] as $region) {
      self::assertStringContainsString('data-list-region="' . $region . '"', $html);
    }
  }

  /**
   * Every approved field renders its formatter's face in its own region.
   */
  public function testEachFieldRendersItsFaceInItsRegion(): void {
    $conductor = $this->createEntity('bb_conductor', [
      'label' => 'cw-framework',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      // A conductor's own read is owner-gated, so the reader owns this one.
      'owner_user_id' => $this->reader->id(),
    ]);
    $ticket = $this->ticket([
      'title' => 'Wire the ticket list',
      'state' => 'working',
      'priority' => 1,
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $this->reader->id(),
    ]);
    $item = $this->itemOf($this->renderList($this->executed()), $ticket);

    // The state is a glyph named by the workflow's own label; working is
    // the filled disc, occupancy is the rail.
    $avatar = $this->regionOf($item, 'avatar');
    self::assertStringContainsString('role="img"', $avatar);
    self::assertStringContainsString('title="Working"', $avatar);
    self::assertStringContainsString('#status-running', $avatar, 'Working is the working disc.');
    self::assertStringContainsString('bg-state-running', $item, 'A conductor paints the teal rail.');

    $headline = $this->regionOf($item, 'headline');
    self::assertStringContainsString('Wire the ticket list', $headline);
    self::assertMatchesRegularExpression('/data-badge-label(="")?>High</', $headline);
    self::assertStringNotContainsString('P1', $item);

    $meta = $this->regionOf($item, 'meta');
    self::assertStringContainsString('font-mono text-data', $meta, 'The identifier leads the meta line.');
    self::assertStringContainsString('href="' . $ticket->toUrl()->toString() . '"', $meta);
    self::assertStringContainsString('Created', $meta);
    self::assertMatchesRegularExpression('/\d+ \w+ (ago|hence)/', $meta);
    self::assertMatchesRegularExpression('/>by<.*' . preg_quote((string) $this->reader->getDisplayName(), '/') . '/s', $meta, 'The creator is named after "by".');
    self::assertStringContainsString('bg-state-lease-tint', $meta);
    self::assertStringContainsString('cw-framework', $meta);
    self::assertStringNotContainsString('data-cell="stall_reason"', $item, 'A ticket with a conductor is not standing still.');
    self::assertStringNotContainsString('project-a', $item, 'The project left the row.');

    $right = $this->regionOf($item, 'right');
    self::assertStringContainsString('data-cell="assignee"', $right);
    self::assertStringContainsString('role="img"', $right, 'The assignee is a mark named by its tooltip.');
  }

  /**
   * Absent optional values leave no cell, and dropped columns never render.
   */
  public function testAbsentOptionalValuesAndDroppedColumnsRenderNothing(): void {
    $ticket = $this->ticket(['state' => 'working']);
    $item = $this->itemOf($this->renderList($this->executed()), $ticket);

    self::assertStringNotContainsString('data-cell="priority"', $item);
    self::assertStringNotContainsString('data-cell="conductor"', $item);
    self::assertStringNotContainsString('data-cell="owner"', $item, 'No creator is no "by", not "by Unassigned".');
    self::assertStringNotContainsString('data-cell="team"', $item);
    self::assertStringNotContainsString('—', $this->regionOf($item, 'headline'));
    self::assertStringNotContainsString('—', $this->regionOf($item, 'meta'));
    self::assertStringContainsString('title="Unassigned"', $this->regionOf($item, 'right'), 'An unclaimed ticket is named, not dashed.');
  }

  /**
   * A frozen ticket names why it is standing still on the listing row.
   */
  public function testFrozenTicketNamesItsStallReason(): void {
    $ticket = $this->ticket(['state' => 'working']);
    $ticket->setFrozen(TRUE)->save();
    $item = $this->itemOf($this->renderList($this->executed()), $ticket);
    $meta = $this->regionOf($item, 'meta');
    self::assertStringContainsString('data-cell="stall_reason"', $meta);
    $stall = (new Crawler($meta))->filter('[data-cell="stall_reason"]')->text();
    self::assertStringContainsString('frozen', $stall);
    self::assertMatchesRegularExpression('/just now|.+ ago/', $stall);
  }

  /**
   * A markup-like title is escaped text, never markup.
   */
  public function testMarkupLikeTitleIsEscaped(): void {
    $ticket = $this->ticket(['title' => '<b>bold</b> & <script>x</script>']);
    $item = $this->itemOf($this->renderList($this->executed()), $ticket);

    self::assertStringNotContainsString('<b>bold</b>', $item);
    self::assertStringNotContainsString('<script>', $item);
    self::assertStringContainsString('&lt;b&gt;bold&lt;/b&gt;', $item);
  }

  /**
   * The rail is occupancy, except review which stays amber.
   */
  public function testTheRenderedRailFollowsOccupancyAndReview(): void {
    $conductor = $this->createEntity('bb_conductor', [
      'label' => 'rail-conductor',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'owner_user_id' => $this->reader->id(),
    ]);

    $working_idle = $this->ticket(['state' => 'working']);
    $working_held = $this->ticket([
      'state' => 'working',
      'conductor_id' => $conductor->id(),
    ]);
    $plan_held = $this->ticket([
      'state' => 'plan',
      'conductor_id' => $conductor->id(),
    ]);
    $review_held = $this->ticket([
      'state' => 'review',
      'conductor_id' => $conductor->id(),
    ]);
    $review_idle = $this->ticket(['state' => 'review']);
    $plan_idle = $this->ticket(['state' => 'plan']);
    $html = $this->renderList($this->executed());

    $this->assertRail($this->itemOf($html, $working_idle), 'bg-transparent');
    $this->assertRail($this->itemOf($html, $working_held), 'bg-state-running');
    $this->assertRail($this->itemOf($html, $plan_held), 'bg-state-running');
    $this->assertRail($this->itemOf($html, $review_held), 'bg-state-attention');
    $this->assertRail($this->itemOf($html, $review_idle), 'bg-state-attention');
    $this->assertRail($this->itemOf($html, $plan_idle), 'bg-transparent');
    self::assertStringNotContainsString('data-row-url', $html);
  }

  /**
   * A run count shows in the meta line only when the ticket has runs.
   */
  public function testTheRunCountShowsOnlyWhenThereAreRuns(): void {
    $conductor = $this->createEntity('bb_conductor', [
      'label' => 'count-conductor',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'owner_user_id' => $this->reader->id(),
    ]);
    $with = $this->ticket(['state' => 'working']);
    $without = $this->ticket(['state' => 'plan']);
    $this->createEntity('bb_run', [
      'ticket_id' => $with->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $this->reader->id(),
      'state' => 'claimed',
    ]);
    $this->createEntity('bb_run', [
      'ticket_id' => $with->id(),
      'conductor_id' => $conductor->id(),
      'owner_user_id' => $this->reader->id(),
      'state' => 'done',
    ]);
    $html = $this->renderList($this->executed());

    $with_meta = $this->regionOf($this->itemOf($html, $with), 'meta');
    self::assertStringContainsString('2 runs', $with_meta);
    self::assertStringContainsString('#run', $with_meta);
    self::assertStringNotContainsString(
      'run',
      $this->regionOf($this->itemOf($html, $without), 'meta'),
    );
  }

  /**
   * The occupancy rail is never the wait accent; a finished row has no stall.
   */
  public function testNoItemIsTinted(): void {
    foreach (['qualification', 'plan', 'working', 'review', 'done', 'cancelled'] as $state) {
      $this->ticket(['state' => $state]);
    }
    $html = $this->renderList($this->executed());

    self::assertDoesNotMatchRegularExpression(
      '/w-1 rounded-xs bg-state-unassigned[^-]/',
      $html,
    );
  }

  /**
   * A done or cancelled row never names a stall reason.
   */
  public function testFinishedRowsNameNoStall(): void {
    $tickets = [
      'done' => $this->ticket(['state' => 'done']),
      'cancelled' => $this->ticket(['state' => 'cancelled']),
    ];
    $html = $this->renderList($this->executed());
    foreach ($tickets as $state => $ticket) {
      $item = $this->itemOf($html, $ticket);
      self::assertStringNotContainsString('data-cell="stall_reason"', $item, $state);
    }
  }

  /**
   * Sorting is one combined select; no header link sorts any more.
   */
  public function testSortingIsOneCombinedSelectAndNoHeaderSorts(): void {
    $this->ticket();
    $view = $this->executed();
    $html = $this->renderList($view);
    $form = (string) $this->container->get('renderer')->renderInIsolation($view->exposed_widgets);

    self::assertStringNotContainsString('order=', $html);
    self::assertStringNotContainsString('aria-sort', $html);
    self::assertStringContainsString('name="sort_bef_combine"', $form);
    self::assertStringContainsString('>Sort by<', $form);
    self::assertMatchesRegularExpression('/<option value="changed_DESC"\s+selected(="selected")?>Updated, newest first<\/option>/', $form);
    $values = [
      'changed_ASC', 'identifier_ASC', 'identifier_DESC',
      'state_ASC', 'state_DESC', 'priority_ASC', 'priority_DESC',
    ];
    foreach ($values as $value) {
      self::assertStringContainsString('value="' . $value . '"', $form);
    }
    // The title search and the sort lead the form; the toolbar prints both.
    preg_match_all('/<(?:select|input)\b(?![^>]*type="hidden")[^>]*\bname="([^"]+)"/', $form, $controls);
    self::assertSame(['title', 'sort_bef_combine'], array_slice(array_values(array_unique($controls[1])), 0, 2), 'Search and sort come before the filters.');
  }

  /**
   * Every combined sort orders the actual rows, with a stable tie-breaker.
   */
  public function testEveryCombinedSortOrdersTheRows(): void {
    $low = $this->ticket(['priority' => 4, 'state' => 'plan']);
    $high = $this->ticket(['priority' => 1, 'state' => 'working']);
    // Ties on priority: the unique tie-breaker orders them in the chosen
    // direction.
    $tie_a = $this->ticket(['priority' => 2, 'state' => 'review']);
    $tie_b = $this->ticket(['priority' => 2, 'state' => 'review']);

    // The world's own fixture ticket has no priority; only these four count.
    $mine = array_map('intval', [$low->id(), $high->id(), $tie_a->id(), $tie_b->id()]);
    $ids = fn (string $sort): array => array_values(array_intersect(array_map(
      fn ($row) => (int) $row->_entity->id(),
      $this->executed(['sort_bef_combine' => $sort])->result,
    ), $mine));
    $identifiers = fn (string $sort): array => array_map(
      fn ($row) => (string) $this->ticketOf($row)->get('identifier')->value,
      $this->executed(['sort_bef_combine' => $sort])->result,
    );

    self::assertSame(array_map('intval', [$high->id(), $tie_a->id(), $tie_b->id(), $low->id()]), $ids('priority_ASC'));
    // The tie-breaker follows the direction, so the tied pair reverses too.
    self::assertSame(array_map('intval', [$low->id(), $tie_b->id(), $tie_a->id(), $high->id()]), $ids('priority_DESC'));
    $ascending = $identifiers('identifier_ASC');
    $sorted = $ascending;
    sort($sorted, SORT_STRING);
    self::assertSame($sorted, $ascending);
    self::assertSame(array_reverse($ascending), $identifiers('identifier_DESC'));
    $states = array_map(
      fn ($row) => (string) $this->ticketOf($row)->get('state')->value,
      $this->executed(['sort_bef_combine' => 'state_ASC'])->result,
    );
    $sorted_states = $states;
    sort($sorted_states, SORT_STRING);
    self::assertSame($sorted_states, $states);
  }

  /**
   * The ticket search matches words of the title.
   */
  public function testTheSearchMatchesTitleWords(): void {
    $needle = $this->ticket(['title' => 'Rotate the zebra credentials']);
    $this->ticket(['title' => 'Something else entirely']);
    $ids = array_map(
      fn ($row) => (int) $row->_entity->id(),
      $this->executed(['title' => 'zebra'])->result,
    );

    self::assertSame([(int) $needle->id()], $ids);
  }

  /**
   * An invalid sort value is refused by form validation, without an error.
   *
   * Views aborts the query of an exposed form that fails validation, so the
   * listing renders no rows rather than an unsorted or unscoped set.
   */
  public function testInvalidSortValueIsRefusedWithoutError(): void {
    $this->ticket();
    $view = $this->executed(['sort_bef_combine' => 'bogus_SIDEWAYS'], FALSE);
    self::assertSame([], $view->result);
    self::assertStringNotContainsString('data-list-item', $this->renderList($view));
  }

  /**
   * A saved ticket in the in-scope project.
   *
   * @param array<string, mixed> $values
   *   Field values over the defaults.
   *
   * @return \Drupal\bb_core\Entity\BbTicketInterface
   *   The ticket.
   */
  private function ticket(array $values = []): BbTicketInterface {
    $ticket = $this->createEntity('bb_ticket', $values + [
      'title' => 'Wire the ticket list',
      'workflow' => 'bb_work',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Indexes everything, then executes the view as the in-scope reader.
   *
   * @param array<string, string> $query
   *   Extra query arguments, such as a combined sort value.
   * @param bool $expect_rows
   *   Whether an empty result fails the test.
   *
   * @return \Drupal\views\ViewExecutable
   *   The executed view.
   */
  private function executed(array $query = [], bool $expect_rows = TRUE): ViewExecutable {
    $index = Index::load('bb_tickets');
    self::assertNotNull($index, 'The bb_tickets index is missing.');
    $index->indexItems();

    $view = Views::getView('tickets');
    self::assertInstanceOf(ViewExecutable::class, $view);
    $view->setDisplay(self::DISPLAY_ID);

    // BB-490's default hides closed rows; this test is about the rendered
    // rail per STATE, including 'done', which the ticket-closure trigger
    // marks closed. `?closed=all` keeps every state's row on screen so the
    // phase/tint assertions stay about rendering rather than about the
    // default's own visibility. Set on the CURRENT request rather than
    // pushed as a new one: a fresh `Request` carries no session, and
    // `ExposedFormPluginBase::buildForm()` needs one for every one of this
    // class's tests, not only this one.
    $this->container->get('request_stack')->getCurrentRequest()?->query->replace(['closed' => 'all'] + $query);

    $switcher = $this->container->get('account_switcher');
    // The read scope is re-applied by a Search API processor (spec D2), so an
    // account with no membership would render an empty table and every
    // assertion below would be about nothing.
    $switcher->switchTo($this->reader);
    try {
      $view->preExecute([self::WORKSPACE_SLUG]);
      $view->execute(self::DISPLAY_ID);
    }
    finally {
      $switcher->switchBack();
    }

    if ($expect_rows) {
      self::assertNotEmpty($view->result, 'Nothing was indexed, so nothing is being asserted.');
    }
    return $view;
  }

  /**
   * The ticket behind a result row.
   */
  private function ticketOf(ResultRow $row): BbTicketInterface {
    self::assertInstanceOf(BbTicketInterface::class, $row->_entity);
    return $row->_entity;
  }

  /**
   * Renders the view's style output — the list and nothing around it.
   *
   * @param \Drupal\views\ViewExecutable $view
   *   The executed view.
   *
   * @return string
   *   The markup.
   */
  private function renderList(ViewExecutable $view): string {
    // AS THE READER: a Views field handler calls its formatter during RENDER,
    // so the reference fields evaluate `view label` here.
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($this->reader);
    try {
      $build = $view->style_plugin->render();
      return (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * The `<li>` of one ticket, found by the link in its identifier cell.
   *
   * @param string $html
   *   The rendered list.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket whose item is wanted.
   *
   * @return string
   *   The item markup.
   */
  private function itemOf(string $html, BbTicketInterface $ticket): string {
    $href = $ticket->toUrl()->toString();
    $items = (new Crawler($html))->filter('li[data-list-item]')
      ->reduce(fn (Crawler $item): bool => $item->filter('a[href="' . $href . '"]')->count() > 0);
    self::assertCount(1, $items, sprintf('No single item links to %s.', $href));
    return $items->outerHtml();
  }

  /**
   * The leading rail of an item carries this accent class.
   */
  private function assertRail(string $item, string $accent): void {
    self::assertMatchesRegularExpression(
      '/w-1 rounded-xs ' . preg_quote($accent, '/') . '/',
      $item,
    );
  }

  /**
   * The markup of one region of an item.
   *
   * @param string $item
   *   The item markup.
   * @param string $region
   *   The region: `headline`, `meta` or `right`.
   *
   * @return string
   *   The region markup.
   */
  private function regionOf(string $item, string $region): string {
    $nodes = (new Crawler($item))->filter(sprintf('[data-list-region="%s"]', $region));
    self::assertCount(1, $nodes, sprintf('The item has no single %s region.', $region));
    return $nodes->outerHtml();
  }

}
