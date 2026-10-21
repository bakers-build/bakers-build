<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbVocabulary;
use Drupal\bb_core\Plugin\UiPatterns\Source\TicketCreateActionSource;
use Drupal\search_api\Entity\Index;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;
use PHPUnit\Framework\Attributes\Group;

/**
 * The list screen is one canvas, composed INSIDE the view (BB-413, 04-09).
 *
 * THE HUMAN'S DECISION. "`BbTicketListController.php` is not needed. Here we
 * should simply use a view route and have the canvas rendered inside/around the
 * view — that should all work through the display builder." So the view has its
 * page display back at `_workspace/%bb_workspace/tickets`, the controller and
 * its route are deleted, and `bb_theme:canvas` is a `display_builder` sources
 * tree on that display: the exposed form in `filters`, the header area and the
 * rows and the pager in `main`.
 *
 * WHAT MAKES THE CANVAS APPEAR, because it is not a template of ours.
 * `display_builder_views` registers a runtime theme-registry entry for the
 * suggestion `views_view__tickets__page` pointing at its own
 * `views-view.html.twig`, which is the single line `{{ content }}`;
 * `PreprocessViewsView` then replaces `$variables['content']` with the built
 * sources tree. The suggestion is per view AND per display PLUGIN — Views emits
 * `views_view__<id>__<display_plugin>` only when the display id differs from
 * the plugin id — so the canvas reaches THIS view's page display and nothing
 * else. That is the whole of the no-leak argument: it is not a condition
 * anybody maintains, it is the address of a template.
 *
 * WHY IT IS NOT A SECOND PAGE LAYOUT, measured rather than preferred. Page
 * layouts do not compose, they OVERRIDE:
 * `AccessControlHandler::loadCurrentPageLayout()` sorts by weight ascending and
 * returns the FIRST entity whose conditions pass, and `PageVariantSubscriber`
 * uses that one. A second layout conditioned on `/_workspace/*​/tickets` would
 * therefore REPLACE `bb_shell` rather than nest inside it, and the rail, the
 * topbar and the status bar would have to be declared a second time. The shell
 * layout is unchanged and keeps wrapping this screen through its own
 * `main_page_content` source.
 *
 * WHY `exposed_block` IS FALSE, and this reverses the previous delivery.
 * `ExposedFormPluginBase::renderExposedForm($block = FALSE)` returns `[]`
 * whenever the display option is on, so with `exposed_block: true` the
 * `view_exposed` source has nothing to place and the aside renders empty —
 * measured on the live surface as 0 forms and 0 facet panels. Placing the
 * `views_exposed_filter_block` instead is worse than empty: the block builds
 * its OWN `ViewExecutable` with no route arguments, so `ViewsExposedForm` asks
 * `$view->getUrl()`, Views substitutes the wildcard for `{bb_workspace}`, and
 * the slug requirement rejects it — `InvalidParameterException`, HTTP 500,
 * measured. With the option off the form is rendered by the view itself and the
 * action is the address the reader is on.
 *
 * THE ORDER IS STILL THE LOAD-BEARING FACT, and it is now facets' own to keep.
 * `FacetsFilter::valueForm()` returns an empty form while `facet_results` is
 * unset, and `ViewExecutable::build()` renders the exposed form BEFORE the
 * query runs. What fills it is `facets_exposed_filters`'
 * `hook_views_post_execute()`, which populates `facet_results`, marks the
 * display post-executed and RE-RENDERS `$view->exposed_widgets`. Measured on
 * this view as an authenticated member: 14 option rows after `build()`, 34
 * after `execute()` — the 20 facet values are exactly the difference.
 */
#[Group('bb_core')]
final class TicketListCanvasTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use UserCreationTrait;
  use ProjectsViewTestTrait;

  /**
   * The workspace slug every request in this file is made against.
   *
   * The PUBLIC segment, which is what `BbWorkspacePathProcessor` maps inbound
   * to `/_workspace/{id}/…` — so a request created from it is the one a browser
   * sends and `path('<current>')` answers the address a chip's × must carry.
   */
  private const WORKSPACE_SLUG = 'bakers';

  /**
   * The public tail of the display these assertions render.
   *
   * `page_1` MOVED DOWN ONE SEGMENT ON 2026-09-04. The human decided that a
   * filtered variant of the ticket list is a Views DISPLAY with real filters
   * rather than the same display reached with facet defaults, so the scoped
   * `my_work` display took `/{workspace}/tickets` — the nav home — and the full
   * find-a-ticket table this file renders is `/{workspace}/tickets/all`.
   *
   * IT IS NOT COSMETIC HERE. `views-filters-summary.html.twig` builds a chip's
   * removal address from `path('<current>')`, so the address a chip carries is
   * the address the REQUEST was made at. A request pushed at the old path would
   * produce chips pointing at the scoped list, which is a different screen.
   */
  private const PATH = '/tickets/all';

  /**
   * A SECOND workspace, so a sentence about "the workspace" can be measured.
   *
   * One workspace cannot tell a derived sentence from a copied literal: the
   * ticket-list scene's own sample text names a workspace too, and a test that
   * asserted only the first slug's name would pass on the sample. This slug
   * exists to make the two answers differ (BB-420 Task 19).
   */
  private const OTHER_WORKSPACE_SLUG = 'acme';

  /**
   * The project seeded by {@see seed()}, for the route-binding test (BB-664).
   */
  private BbProjectInterface $project;

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
    // The shell's rail and content are still boosted islands, and the page
    // layout this screen renders through places them — so the module is still
    // required even though the create dialog stopped being one (BB-420
    // Task 24).
    'island',
    // `views_filters_summary` states the chosen facets above the rows
    // (BB-413, 2026-09-04) and the view names it in
    // `dependencies.module`, so the optional config installer refuses the
    // view without it — the symptom is "The tickets view is not installed".
    'views_filters_summary',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views', 'bb_core',
  ];

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
    // Without the tracker's own table nothing is ever tracked and indexItems()
    // answers 0 with no error at all.
    $this->installSchema('search_api', ['search_api_item']);
    $this->installConfig(['user', 'search_api', 'views']);
    $this->installOgScopeFixture();
    $this->enableTheShippedDisplayExtender();
    BbVocabulary::create(['id' => 'bb_labels', 'label' => 'bakers.build labels'])->save();
    $this->container->get('entity_type.bundle.info')->clearCachedBundles();
    $this->container->get('typed_data_manager')->clearCachedDefinitions();
    // The display builder profile the view's extender names. It lives in
    // `display_builder/config/optional`, so a module install does not create it
    // and the extender would fall back to the un-built view.
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'display_builder']);
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install the recipe copy.
    $this->installShippedView('views.view.tickets');
    // The view's page display registers its own route, and the identifier cell
    // is a toUrl().
    $this->container->get('router.builder')->rebuild();
    // The canvas, the aside and the table are all components of the theme, so
    // the theme has to be the one the render is performed with.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    $this->seed();
  }

  /**
   * The screen is the canvas, and the canvas comes from the view.
   */
  public function testTheViewRendersAsTheCanvas(): void {
    $html = $this->screen();

    self::assertStringContainsString(
      'data-component-id="bb_theme:canvas"',
      $html,
      'The display builder tree did not reach the view; this is the bare Views output.',
    );
    self::assertStringContainsString(
      'data-component-id="bb_theme:filters"',
      $html,
      'The filters aside is missing from the canvas.',
    );
    self::assertStringNotContainsString(
      'island-tickets',
      $html,
      'A wrapper of this screen\'s own would nest inside the shell content island.',
    );
  }

  /**
   * The facet options are there, which is the ordering, stated as a claim.
   *
   * This is the assertion the whole composition exists for. It fails — with
   * seven empty pickers and no error — the moment the exposed form the reader
   * receives is the one `ViewExecutable::build()` made rather than the one
   * facets' `hook_views_post_execute()` re-made.
   */
  public function testTheFacetOptionsProveTheViewRanBeforeTheFormWasBuilt(): void {
    $html = $this->screen();

    foreach (['coding', 'review', 'spec'] as $state) {
      self::assertStringContainsString(
        'data-value="' . $state . '"',
        $html,
        sprintf('The State facet offers no %s, so it was built before the query ran.', $state),
      );
    }
  }

  /**
   * The rows are in the same canvas as the facets that narrowed them.
   */
  public function testTheRowsArriveInTheSameCanvasAsTheFacets(): void {
    $html = $this->screen();

    // COUNTED ON `data-list-item`, the attribute the list component puts
    // on every `<li>` it renders.
    self::assertSame(
      3,
      substr_count($html, 'data-list-item'),
      'Three seeded tickets, three rows, from the one pass the facets came from.',
    );
  }

  /**
   * No PHP of ours states this strip any more.
   *
   * THE DELETION IS THE DELIVERABLE, so it is asserted rather than assumed.
   * `TicketFilterSet` read the filter set three times and
   * `Plugin/views/area/TicketFilterSummary` placed the chips; both are gone
   * with the decision to take `views_filters_summary`, and a reintroduction
   * under either name has to fail here. `class_exists` is asked with
   * autoloading ON, which is what makes a re-added file visible.
   */
  public function testTheChipsAreContribsAndNoBbCodeStatesThem(): void {
    self::assertFalse(
      class_exists('Drupal\bb_core\Filter\TicketFilterSet', TRUE),
      'TicketFilterSet is back.',
    );
    self::assertFalse(
      class_exists('Drupal\bb_core\Plugin\views\area\TicketFilterSummary', TRUE),
      'The bakers area handler is back.',
    );
    self::assertFalse(
      $this->container->has('bb_core.ticket_filter_set'),
      'The filter-set service is back.',
    );

    $header = $this->config('views.view.tickets')
      ->get('display.default.display_options.header');
    self::assertSame(
      ['views_filters_summary'],
      array_keys($header ?? []),
      'The header holds exactly one area, and it is the contrib one.',
    );
    self::assertTrue(
      (bool) ($header['views_filters_summary']['group_values'] ?? FALSE),
      'group_values is load-bearing: without it the module emits one entry per VALUE, '
      . 'which cannot feed a chip that is one facet with several values.',
    );
  }

  /**
   * An account that may add gets the action, addressed at the current URL.
   *
   * THE HREF IS A MERGE, NOT A SUFFIX. It is asserted from an address that
   * already carries a query, because a literal suffix would throw everything
   * the reader had chosen away. The surviving key asserted
   * here is a NEUTRAL one rather than a facet: Views rewrites its own exposed
   * input on the way through, so asserting a facet's spelling would pin this
   * test to Views' encoding rather than to the property under test.
   *
   * THE TRIGGER IS FOUND BY ITS ACCESSIBLE NAME. It is icon-only, so
   * `button.twig` moves `label` into `aria-label` — the same name the browser
   * scenario reaches it by, and the same name an operator using a screen
   * reader hears.
   */
  public function testTheAddActionIsOfferedToAnAccountThatMayCreate(): void {
    $this->asAccountWith(['administer bakers', 'view bb_ticket', 'create bb_ticket']);

    $html = $this->addActionMarkup(self::WORKSPACE_SLUG, 'keep=me');

    self::assertStringContainsString('aria-label="New ticket"', $html);
    // The SPRITE REFERENCE, which is what `icon.twig` renders the `name` prop
    // as. Asserting the prop's own spelling would measure the render array
    // this test never sees.
    self::assertStringContainsString(
      'sprite.svg?v=' . $this->container->get('asset.query_string')->get() . '#plus',
      $html,
      'The icon-only action carries the plus icon.',
    );
    $href = $this->hrefOfTheAddAction($html);
    // THE ROUTE, not this screen's own address with a parameter bolted on
    // (BB-420 Task 24). The dialog is a surface of its own now, so the plain
    // href is where a browser with no JavaScript LANDS — a real page carrying
    // the same dialog — and `hx-get` fetches the same address through the
    // wrapper format.
    self::assertStringStartsWith('/bakers/ticket/create?', $href, 'The trigger addresses the create route.');
    self::assertStringContainsString('keep=me', $href, 'The merge adds a key, it does not replace the query.');
    // The screen the dialog is opened OVER, which the form reads back as
    // `Cancel`'s href and as the post-write `HX-Location`. The dialog no
    // longer renders on that screen, so nothing else can answer for it.
    // `/` is not percent-encoded by `UrlHelper::buildQuery()`, and the QUERY
    // inside the destination is — `destination=/bakers/tickets/all%3Fkeep%3Dme` —
    // which is what keeps the screen's own query from leaking into the
    // dialog's.
    self::assertStringContainsString('destination=/bakers/tickets/all', $href);
    self::assertStringContainsString('%3Fkeep%3Dme', $href, 'The screen keeps its own query, encoded.');
    self::assertStringNotContainsString('_wrapper_format', $href, 'The plain href is a page url.');
  }

  /**
   * The per-project ticket list binds the dialog to its ROUTE project (AC-1).
   *
   * `view.tickets.project_tickets` carries the project as a route parameter
   * (`/_workspace/{bb_workspace}/project/{bb_project}/tickets`), which the
   * forwarded screen query never sees — only the request's query string is
   * forwarded. A stale or conflicting `project` facet in that query must not
   * win over the route the dialog was actually opened from (BB-664).
   */
  public function testTheAddActionOnTheProjectScreenBindsToTheRouteProject(): void {
    $other_project = $this->create('bb_project', ['name' => 'Other', 'key' => 'othr']);
    self::assertInstanceOf(BbProjectInterface::class, $other_project);

    $html = $this->addActionMarkup(
      self::WORKSPACE_SLUG,
      'project=' . $other_project->id(),
      '/project/' . $this->project->id() . '/tickets',
    );

    $href = $this->hrefOfTheAddAction($html);
    self::assertStringContainsString(
      'project=' . $this->project->id(),
      $href,
      'The route project wins over the conflicting facet.',
    );
    self::assertStringNotContainsString(
      'project=' . $other_project->id(),
      $href,
      'The stale facet value must not reach the dialog.',
    );
  }

  /**
   * The trigger fetches the dialog ROUTE into one overlay, declaring no peer.
   *
   * BB-420 Task 24 replaced a boosted link that named an out-of-band peer —
   * `hx-select-oob` plus the `X-Island-Also` header, both written by
   * `IslandBoost` — with a plain `hx-get` at one target. That is not a smaller
   * spelling of the same thing: TWO settled elements is precisely the shape
   * core's htmx bridge gets wrong, because it reads `detail.elt` a microtask
   * after `htmx:afterSettle` and htmx has advanced it by then. Measured in a
   * browser on the old path: the dialog arrived with five unwired option
   * pickers, nothing could be picked, and the submit stayed disabled forever.
   *
   * The absence of the peer declaration is therefore asserted, not merely the
   * presence of the target.
   *
   * AND SO IS `hx-select`, which is the one attribute here that is not
   * obviously needed and is the one that cannot be dropped. This link renders
   * INSIDE the shell's content island, whose boosted machinery declares
   * `hx-select` on the subtree it covers — and htmx INHERITS `hx-select` from
   * ancestors. The dialog response contains no `#island-content`, so without a
   * selection of its own the swap is of NOTHING, and it fails silently: HTTP
   * 200, an `htmx:afterSwap` on the right target, an empty overlay. Measured
   * exactly that way before the attribute was added. `form#…` and not `#…`
   * because the response carries the form and the dialog hull under the SAME
   * id, so a bare id selector resolves by document order rather than by
   * intent.
   */
  public function testTheTriggerFetchesTheDialogRouteIntoTheOneOverlay(): void {
    $this->asAccountWith(['administer bakers', 'view bb_ticket', 'create bb_ticket']);

    $container = $this->addActionContainerFrom($this->addActionMarkup(self::WORKSPACE_SLUG));

    // `data-hx-*` is core's own spelling: `Drupal\Core\Htmx\Htmx` writes the
    // data-prefixed form, which htmx reads identically. Asserting the bare
    // prefix would pass on the prefixed one and hide a change of author.
    self::assertStringContainsString('data-hx-get="', $container);
    self::assertStringContainsString('_wrapper_format=island_dialog', $container);
    self::assertStringContainsString('data-hx-target="#' . TicketCreateActionSource::TARGET_ID . '"', $container);
    self::assertStringContainsString('data-hx-swap="innerHTML', $container);
    // `dialog` AND NOT `form#…` since the operator ruling of 2026-09-08. The
    // hull is the form's ANCESTOR now — `island`'s wrapper format wraps this
    // route's main content, where the surface used to compose its own hull
    // inside the form's own template — so selecting the form would hand the
    // overlay a bare `<form>` and leave the document with no `<dialog>` at
    // all, on a green 200. `ProjectCreateActionTest` measured exactly that in
    // a browser when the old reasoning was copied to the other trigger.
    // Only the OUTERMOST dialog: htmx swaps in every match, and a nested one
    // (the image crop dialog) would be lifted out beside the hull.
    self::assertStringContainsString(
      'data-hx-select="dialog:not(dialog dialog)"',
      $container,
      'Without its own selection the trigger inherits the content island\'s, and swaps nothing.',
    );
    self::assertStringNotContainsString('select-oob', $container, 'The trigger declares no out-of-band peer.');
    self::assertStringNotContainsString('island-shell', $container);
  }

  /**
   * An account that may not add gets NO action — absent, never disabled.
   *
   * `action-pattern.md`'s `actions` slot contract: a screen that cannot
   * receive an addition offers nothing. A disabled control would invite the
   * operator to hunt for the condition that enables it.
   */
  public function testTheAddActionIsAbsentForAnAccountThatMayNotCreate(): void {
    $this->asWorkspaceGuest();

    $html = $this->addActionMarkup(self::WORKSPACE_SLUG);

    self::assertStringNotContainsString('aria-label="New ticket"', $html, 'The affordance is absent, not disabled.');
    self::assertStringNotContainsString('/bakers/ticket/create', $html);
  }

  /**
   * The gate declares its cache context on BOTH branches, not just the yes.
   *
   * Ruling R15 follow-on. The context was once declared only where the button
   * was built, so the negative branch was correct only because the view
   * beside it happened to contribute `user.permissions` anyway. That is a
   * neighbour's property, not this build's, and it stops being true the
   * moment the neighbour changes — the exact shape of bug that is invisible
   * until a reader is served a cached "nothing" after being granted the
   * permission.
   *
   * IT IS ASKED OF THE SOURCE, NOT OF THE SCREEN, and that is the point: on
   * the rendered screen the view's own metadata would answer for it, which is
   * precisely the neighbour this test refuses to trust.
   */
  public function testTheGateDeclaresThePermissionContextEvenWhenItOffersNothing(): void {
    $this->asWorkspaceGuest();

    $value = $this->createActionSource()->getPropValue();

    self::assertIsArray($value);
    self::assertArrayNotHasKey('trigger', $value, 'This account may not create; nothing is offered.');
    self::assertContains(
      'user.permissions',
      $value['#cache']['contexts'] ?? [],
      'A refusal is as permission-dependent as an offer.',
    );
  }

  /**
   * The add action, rendered on the same request the screen uses.
   */
  private function addActionMarkup(string $slug, string $query = '', ?string $path = NULL): string {
    $request = Request::create('/' . $slug . ($path ?? self::PATH) . ($query === '' ? '' : '?' . $query));
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    else {
      $request->setSession(new Session(new MockArraySessionStorage()));
    }
    $request->attributes->add($this->container->get('router')->matchRequest($request));
    $this->container->get('request_stack')->push($request);
    try {
      $build = $this->createActionSource()->getPropValue();
      self::assertIsArray($build);
      return (string) $this->container->get('renderer')->renderInIsolation($build);
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * The href of the header's add action, cut out of a rendered trigger.
   */
  private function hrefOfTheAddAction(string $html): string {
    $matched = preg_match(
      '@<a[^>]*href="([^"]+)"[^>]*aria-label="New ticket"@',
      $this->addActionContainerFrom($html),
      $matches,
    );
    self::assertSame(1, $matched, 'The add action did not render as an anchor with an accessible name.');

    return html_entity_decode($matches[1]);
  }

  /**
   * The add action's own anchor, cut out of a rendered screen.
   *
   * THE ANCHOR AND NOT A CONTAINER: BB-420 Task 24 deleted the wrapping
   * `<div id="ticket-list-new-ticket">`, which existed only because the boosted
   * trigger targeted ITSELF and a swap needs a stable id to land in. The
   * declaration is now on the link.
   *
   * @param string $html
   *   The rendered screen.
   *
   * @return string
   *   The anchor's opening tag.
   */
  private function addActionContainerFrom(string $html): string {
    $at = strpos($html, 'aria-label="New ticket"');
    self::assertNotFalse($at, 'The add action did not render.');
    $start = strrpos(substr($html, 0, $at), '<a ');
    self::assertNotFalse($start, 'The add action did not render as an anchor.');
    $end = strpos($html, '>', $at);
    self::assertNotFalse($end);

    return substr($html, $start, $end - $start);
  }

  /**
   * A workspace guest: may view the screen, may not create through its route.
   */
  private function asWorkspaceGuest(): void {
    $this->asAccountWith(['view bb_ticket']);
    $workspaces = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->loadByProperties(['slug' => self::WORKSPACE_SLUG]);
    $workspace = reset($workspaces);
    self::assertInstanceOf(ContentEntityInterface::class, $workspace);
    $account = $this->container->get('current_user')->getAccount();
    self::assertInstanceOf(UserInterface::class, $account);
    $this->addMembership($workspace, $account, ['guest']);
  }

  /**
   * Switches the current account to one holding exactly these permissions.
   *
   * `administer bakers` is in every list because the ROUTE is access-checked
   * before this screen renders: `_bb_workspace_match` answers 404 for an
   * account outside the workspace's read scope, and a 404 would read like a
   * missing action. It does not grant `create bb_ticket` — asserted below,
   * so a future permission that folded the two together cannot make the
   * negative case pass by accident.
   *
   * @param array<string> $permissions
   *   The permissions to grant.
   */
  private function asAccountWith(array $permissions): void {
    $account = $this->createUser($permissions);
    self::assertInstanceOf(UserInterface::class, $account);
    self::assertSame(
      in_array('create bb_ticket', $permissions, TRUE),
      $account->hasPermission('create bb_ticket'),
      'The fixture must not grant the gated permission by a side door.',
    );
    $this->setCurrentUser($account);
  }

  /**
   * A fresh add-action source, reading the request and the account as they are.
   *
   * Configured through `SourcePluginBase::buildConfiguration()` — the factory
   * `ComponentElementBuilder` itself calls — rather than by hand-assembling
   * the array, and the prop definition is READ from the `slot` PropType so
   * this test cannot pass against a shape the product no longer has.
   */
  private function createActionSource(): TicketCreateActionSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_ticket_create_action',
        SourcePluginBase::buildConfiguration('actions', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(TicketCreateActionSource::class, $source);

    return $source;
  }

  /**
   * The view's page display, rendered the way a request renders it.
   *
   * @return string
   *   The markup.
   */
  private function screen(string $slug = self::WORKSPACE_SLUG): string {
    $view = Views::getView('tickets');
    self::assertNotNull($view, 'The tickets view is not installed.');
    // The slug is the route argument `ViewPageController::handle()` reads off
    // `{bb_workspace}` and hands to the display. Passing it here is what
    // makes this render the one a request performs.
    $build = $view->buildRenderable('page_1', [$slug]);

    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Turns the display-builder extender on, from the object the repo ships.
   *
   * A KERNEL TEST DOES NOT RUN `hook_install()`. `$modules` puts a module in
   * the kernel's list; it never calls the module installer, which is why
   * `installConfig()` and `installEntitySchema()` are explicit here. So
   * `display_builder_views_install()` — the ONLY thing that appends
   * `display_builder` to `views.settings` › `display_extenders` — does not
   * fire, `DisplayPluginBase::init()` instantiates no extenders, and the view
   * renders as a bare Views table with no canvas and no error. Measured:
   * `display_extenders = NULL`, `extenders = ''`, suggestion entry `NONE`.
   *
   * IT IS READ FROM `config/sync`, NOT WRITTEN HERE. That file is what the CIM
   * path installs, and it is the half of this wiring a `drush cim` can silently
   * undo: an import that reset `display_extenders` to `{}` would switch the
   * canvas off while leaving every module enabled. Reading the shipped value
   * makes this test fail if the repository stops shipping it.
   */
  private function enableTheShippedDisplayExtender(): void {
    $file = dirname(__DIR__, 7) . '/config/sync/views.settings.yml';
    self::assertFileExists($file, 'The repository ships views.settings.');
    $shipped = Yaml::parseFile($file);
    self::assertIsArray($shipped);
    self::assertContains(
      'display_builder',
      $shipped['display_extenders'] ?? [],
      'config/sync/views.settings.yml must name the display_builder extender, or the canvas is off after every drush cim.',
    );
    $this->config('views.settings')
      ->set('display_extenders', $shipped['display_extenders'])
      ->save();
  }

  /**
   * Three tickets spread across three states, all indexed.
   */
  private function seed(): void {
    // `administer bakers` bypasses the read scope, so this fixture is about the
    // composition rather than about tenancy — which TicketIndexReadScopeTest
    // owns.
    $account = $this->createUser(['administer bakers', 'view bb_ticket']);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->setCurrentUser($account);

    $workspace = $this->create('bb_workspace', [
      'name' => 'bakers.build',
      'slug' => self::WORKSPACE_SLUG,
    ]);
    // A SECOND workspace, with no rows of its own. It exists so the header's
    // sub-line can be measured as a derivation rather than as a literal; it
    // holds no group, project or ticket, so every row count in this file is
    // unchanged by it.
    $this->create('bb_workspace', [
      'name' => 'Acme',
      'slug' => self::OTHER_WORKSPACE_SLUG,
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
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;

    foreach (['coding', 'review', 'spec'] as $state) {
      $this->create('bb_ticket', [
        'title' => 'Ticket ' . $state,
        'state' => $state,
        'workflow' => 'bb_feature',
        'priority' => 2,
        'project_id' => $project->id(),
      ]);
    }

    $index = Index::load('bb_tickets');
    self::assertNotNull($index);
    self::assertSame(
      3,
      $index->indexItems(),
      'All three tickets must be indexed, or an empty facet proves nothing.',
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
