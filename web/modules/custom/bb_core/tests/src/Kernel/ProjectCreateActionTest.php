<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Asset\AssetQueryString;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Theme\Icon\IconCollector;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Plugin\UiPatterns\Source\ProjectCreateActionSource;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\Yaml\Yaml;

/**
 * The `New project` affordance, offered by the shell page_header island.
 *
 * Spec D9. WHY THE TRIGGER IS A SOURCE is argued once, in
 * `TicketCreateActionSource`'s own docblock, and this file does not restate it:
 * a trigger that lived inside the object composing a screen was deleted twice,
 * and a ui_patterns Source is addressed from configuration by plugin id, so a
 * restructure changes the config that PLACES it rather than the plugin.
 *
 * WHAT IS ASSERTED HERE AND WHAT IS NOT. The source is exercised directly
 * rather than through a rendered screen, and that is the deliberate opposite
 * of `TicketListCanvasTest`'s choice. The projects screen is the
 * `workspace_list` page display of `views.view.projects`, so a screen-level
 * assertion would measure the display extender and the theme registry entry at
 * once. What this class owns is two things, and each has its own case: the
 * plugin's own answer (absent or offered, and what the offer addresses), and
 * the view config that no longer paints a header.
 *
 * THE PERMISSION IS ASKED INDEPENDENTLY of the route's
 * `_entity_create_access` and of
 * `BbProjectCreateForm::subjectCreatePermission()` — Ruling R10's three
 * doors that happen to agree on one permission rather than one door three
 * callers trust. This one decides whether the AFFORDANCE is offered at all.
 */
#[Group('bb_core')]
final class ProjectCreateActionTest extends KernelTestBase {

  use ProjectsViewTestTrait;
  use OgScopeFixtureTrait;
  use UserCreationTrait;

  /**
   * The workspace slug every request in this file is made against.
   *
   * The PUBLIC segment, which `BbWorkspacePathProcessor` maps inbound to
   * `/_workspace/{id}/…`, so a request created from it is the one a browser
   * sends and the address the trigger writes as `destination`.
   */
  private const WORKSPACE_SLUG = 'bakers';

  /**
   * The public tail of the screen the trigger is rendered on.
   */
  private const PATH = '/projects';

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'markdown_easy', 'og', 'state_machine', 'views', 'better_exposed_filters',
    // The wrapper format the `hx-get` address names is island's own, and
    // `bb_theme:dialog` reaches it by declaring `replaces: island:dialog` —
    // so the module has to be present for the theme's own component set to
    // resolve at all.
    'island',
    // `views.view.projects` now composes a `display_builder` sources tree, and
    // its `display_extenders.display_builder` schema is
    // `display_builder_views`'. A kernel test SAVES the view, and a save is
    // what the schema is checked on, so the module that owns the schema has to
    // be enabled — which is also the reason the file left
    // `bb_core/config/optional` (spec D9, `CLAUDE.md`).
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
    ] as $entity_type_id) {
      $this->installEntitySchema($entity_type_id);
    }
    $this->installConfig(['system', 'user', 'views']);
    $this->installOgScopeFixture();
    // The view whose header slot places this source. It ships from
    // `recipes/bakers/config` and `config/sync`, neither of which
    // `installConfig()` reads, so a kernel test puts it there itself.
    $this->installShippedView('views.view.projects');
    // The route the trigger addresses is declared in bb_core.routing.yml, and
    // the screen's own route is what a pushed request has to match for the
    // workspace slot to be filled from the ambient workspace.
    $this->container->get('router.builder')->rebuild();
    // The trigger renders `bb_theme:button` and `bb_theme:icon`, so the
    // theme has to be the one the render is performed with.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    // UID 1 IS THE SUPERUSER AND IT IS BURNED HERE DELIBERATELY. A kernel test
    // creates no root account, so the FIRST `createUser()` call gets uid 1 —
    // for which `hasPermission()` answers TRUE for everything, including the
    // one this file gates on. Measured: the negative case granted
    // `view bb_project` and the account held `create bb_project` anyway.
    $this->createUser();

    $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'bakers.build', 'slug' => self::WORKSPACE_SLUG])
      ->save();
  }

  /**
   * An account that may not create gets NO action — absent, never disabled.
   *
   * `action-pattern.md`'s `actions` slot contract, and spec D9. A disabled
   * control would invite the operator to hunt for the condition that enables
   * it.
   *
   * THE CACHE CONTEXT IS ASSERTED ON THE REFUSAL, not only on the offer.
   * Declaring `user.permissions` on the yes alone makes the no correct by
   * accident — whatever renders beside it happens to contribute the same
   * context — and that is a neighbour's property rather than this build's. The
   * failure mode is a reader who is granted the permission and keeps being
   * served a cached "nothing".
   */
  public function testTheActionIsAbsentWithoutThePermission(): void {
    $this->asWorkspaceGuest();

    $value = $this->actionValue();

    self::assertIsArray($value);
    self::assertArrayNotHasKey('#type', $value, 'This account may not create; nothing is offered.');
    self::assertContains(
      'user.permissions',
      $value['#cache']['contexts'] ?? [],
      'A refusal is as permission-dependent as an offer.',
    );
    self::assertSame('', $this->actionMarkup(), 'The affordance is absent, not disabled.');
  }

  /**
   * An account that may create gets the trigger, addressed at both doors.
   *
   * TWO ADDRESSES FOR ONE SURFACE, and they are the same route. The `href` is
   * a plain page url, which is what a browser with no JavaScript follows to a
   * real page carrying the same dialog; `hx-get` is that url plus
   * `_wrapper_format=island_dialog`, which is what makes the click a fragment
   * fetch. `destination` is the screen the dialog is opened over, and it is
   * the only way the dialog can answer "back to where this was opened from".
   */
  public function testTheActionCarriesTheCurrentScreenAsItsDestination(): void {
    $this->asAccountWith(['administer bakers', 'view bb_project', 'create bb_project']);

    $markup = $this->actionMarkup();

    self::assertStringContainsString('/project/create', $markup);
    self::assertStringContainsString('destination=', $markup);
    self::assertStringContainsString('_wrapper_format=island_dialog', $markup);
    self::assertStringContainsString('aria-label="New project"', $markup);
    self::assertStringContainsString(
      'sprite.svg?v=' . $this->container->get('asset.query_string')->get() . '#plus',
      $markup,
      'The icon-only action carries the plus icon.',
    );
  }

  /**
   * The plain `href` is a page url carrying nothing but the destination.
   *
   * TWO ABSENCES AND ONE PRESENCE, and each is a decision rather than a
   * spelling:
   *
   * - No `_wrapper_format`. A format written into the `href` would send a
   *   browser with JavaScript off to a dialog fragment with no document around
   *   it, which is the no-JavaScript path defeating itself.
   * - No forwarded query key. `TicketCreateActionSource` merges the screen's
   *   whole query into the dialog's, because `PickerWidget` reads a field's
   *   opening value off whichever key its `context_parameter` names and the
   *   ticket list has a project facet to inherit. This surface has no context
   *   field at all (spec D4), so a forwarded key would be a mechanism with no
   *   consumer — asserted as an absence so a later copy-paste from the ticket
   *   trigger fails here.
   * - The screen's query IS kept inside `destination`, percent-encoded, because
   *   `Cancel` has to land the reader back on the list they were looking at.
   *   `/` is not percent-encoded by `UrlHelper::buildQuery()` and `?` is, which
   *   is exactly what keeps the screen's query out of the dialog's.
   */
  public function testThePlainHrefCarriesNothingButTheDestination(): void {
    $this->asAccountWith(['administer bakers', 'view bb_project', 'create bb_project']);

    $href = $this->hrefOf($this->actionMarkup('keep=me'));

    self::assertStringStartsWith(
      '/' . self::WORKSPACE_SLUG . '/project/create?',
      $href,
      'The trigger addresses the create route, not this screen with a parameter bolted on.',
    );
    self::assertStringNotContainsString('_wrapper_format', $href, 'The plain href is a page url.');
    self::assertStringContainsString('destination=/' . self::WORKSPACE_SLUG . self::PATH, $href);
    self::assertStringContainsString('%3Fkeep%3Dme', $href, 'The screen keeps its own query, encoded.');
    self::assertStringNotContainsString(
      'keep=me',
      str_replace('%3Fkeep%3Dme', '', $href),
      'The screen\'s query is not forwarded as the dialog\'s own; this surface has no context field.',
    );
  }

  /**
   * The trigger fetches the dialog into the one overlay, declaring no peer.
   *
   * ONE TARGET, NO PEER. Two settled elements is precisely the shape core's
   * htmx bridge gets wrong, and BB-420 measured the cost on the ticket
   * dialog: five unwired option pickers and a submit that never enabled.
   *
   * AND `hx-select`, which is the one attribute here that is not obviously
   * needed and is the one that cannot be dropped. This link renders inside the
   * shell's content island, whose container declares `hx-select` for its own
   * boosted navigations — and htmx INHERITS `hx-select` from ancestors. The
   * dialog response contains no `#island-content`, so without a selection of
   * its own the swap is of NOTHING and it fails silently: HTTP 200, an
   * `htmx:afterSwap` on the right target, an empty overlay.
   *
   * `dialog` AND NOT `form#…`, CORRECTED AGAINST A BROWSER (BB-421 Task 8).
   * This assertion used to pin `form#bakers-project-create`, on reasoning
   * lifted from the ticket trigger: "the response carries the form and the
   * dialog hull under the SAME id". That is true of the TICKET dialog, whose
   * surface composes its own hull inside the form's own `#theme` template — and
   * false of this one, which composes no hull at all (spec D2), so `island`'s
   * `WrappedRouteRenderer` wraps the form and the hull is its ANCESTOR.
   * Selecting the form therefore discarded the hull: measured in Chromium, the
   * overlay received a bare `<form>` and the document held ZERO `<dialog>`
   * elements — no `open` state, no title, and no `dialog__message` for a
   * refusal to render into, which would have made AC 2's error invisible while
   * the POST round trip still looked healthy.
   *
   * The ELEMENT and not an id, because neither hull guarantees one:
   * `hullProps()` passes no `id`, `bb_theme:dialog` falls back to its own
   * `bakers-dialog` default and `island:dialog` has none. `dialog` is the
   * format's own contract — a response in the `island_dialog` format is a
   * dialog — rather than either component's detail.
   *
   * ONLY THE OUTERMOST `dialog`. htmx selects with `querySelectorAll()` and
   * swaps in every match, so a dialog nested in the form — the image crop's —
   * was lifted out beside the hull, away from the component that drives it.
   */
  public function testTheTriggerFetchesTheDialogIntoTheOneOverlay(): void {
    $this->asAccountWith(['administer bakers', 'view bb_project', 'create bb_project']);

    $anchor = $this->anchorOf($this->actionMarkup());

    // `data-hx-*` is core's own spelling: `Drupal\Core\Htmx\Htmx` writes the
    // data-prefixed form, which htmx reads identically.
    self::assertStringContainsString('data-hx-get="', $anchor);
    self::assertStringContainsString('_wrapper_format=island_dialog', $anchor);
    self::assertStringContainsString(
      'data-hx-target="#' . ProjectCreateActionSource::TARGET_ID . '"',
      $anchor,
    );
    self::assertStringContainsString('data-hx-swap="innerHTML', $anchor);
    self::assertStringContainsString(
      'data-hx-select="dialog:not(dialog dialog)"',
      $anchor,
      'Without its own selection the trigger inherits the content island\'s, and swaps nothing.',
    );
    self::assertStringNotContainsString(
      'data-hx-select="form#',
      $anchor,
      'Selecting the form discards the generic hull that wraps it — measured as zero <dialog> elements in the overlay.',
    );
    self::assertStringNotContainsString('select-oob', $anchor, 'The trigger declares no out-of-band peer.');
  }

  /**
   * The trigger puts the dialog's own behaviours on the page it sits on.
   *
   * MEASURED IN CI, AND ONLY THERE, WHICH IS WHY IT IS PINNED HERE. A
   * component library is attached by whatever RENDERS that component, so the
   * option picker's library arrives with the dialog FRAGMENT — and an
   * interaction landing between the swap and that asset's evaluation reaches a
   * control that is on screen and not yet live. The suite reported it as
   * `option_picker.js never attached to this picker` on three project
   * scenarios while every ticket scenario passed, because the ticket LIST
   * renders pickers of its own and this screen renders none: the ticket
   * surface had the library already and hid the race.
   *
   * IT IS THE TRIGGER'S JOB, not the dialog's. An affordance that opens a
   * dialog is the last moment at which the dialog's client code can be on the
   * page BEFORE the operator can interact with it. `island/base` declaring
   * `island/dialog` is the same rule applied to the hull's dismissal
   * listeners, which the same race had taken out twice.
   *
   * ASSERTED ON THE RENDER ARRAY rather than on markup, because that is where
   * `#attached` lives — a rendered anchor shows nothing about its libraries.
   */
  public function testTheTriggerCarriesTheDialogsOwnBehaviours(): void {
    $this->asAccountWith(['administer bakers', 'view bb_project', 'create bb_project']);

    $libraries = $this->actionValue()['#attached']['library'] ?? [];

    self::assertContains(
      'core/components.bb_theme--option_picker',
      $libraries,
      'Without it the picker behaviour arrives with the fragment and loses the race.',
    );
    self::assertContains(
      'core/drupal.htmx',
      $libraries,
      'The htmx transport the trigger\'s own attributes need.',
    );
  }

  /**
   * The projects page places title search above the rows in both copies.
   *
   * BOTH COPIES ARE READ. The homes are `config/sync` for CIM and
   * `recipes/bakers/config` for the recipe path. A search added to one of them
   * is a screen that filters on exactly one install path.
   */
  public function testBothCopiesOfTheProjectsViewOmitTheHeader(): void {
    foreach ($this->shippedProjectsViewCopies() as $where => $data) {
      $sources = $data['display']['workspace_list']['display_options']['display_extenders']['display_builder']['sources'] ?? NULL;
      self::assertIsArray($sources, "$where composes no workspace_list display_builder tree.");

      $listing = $sources[0]['source']['component'] ?? [];
      self::assertSame('bb_theme:zone', $listing['component_id'] ?? NULL, "$where does not compose the listing zone.");
      self::assertArrayNotHasKey(
        'header',
        $listing['slots'] ?? [],
        "$where still paints a page_header; the heading is the shell island.",
      );
      self::assertSame(
        ['component', 'view_rows', 'view_pager', 'view_exposed'],
        array_column($listing['slots']['content']['sources'] ?? [], 'source_id'),
        "$where must place the search toolbar above the listing rows.",
      );
    }
  }

  /**
   * Theme sprite and brand URLs follow the asset token and stay stable.
   */
  public function testThemeSvgUrlsFollowTheAssetToken(): void {
    $state = $this->container->get('state');
    foreach (['before', 'after'] as $token) {
      $state->set(AssetQueryString::STATE_KEY, $token);
      $this->container->get('plugin.manager.icon_pack')->clearCachedDefinitions();
      $this->container->get(IconCollector::class)->clear();
      for ($repeat = 0; $repeat < 2; $repeat++) {
        $icon = [
          '#type' => 'component',
          '#component' => 'bb_theme:icon',
          '#props' => ['name' => 'plus'],
        ];
        $html = (string) $this->container->get('renderer')->renderInIsolation($icon);
        self::assertStringContainsString('sprite.svg?v=' . $token . '#plus', $html);
        foreach (['default', 'compact'] as $size) {
          $brand = [
            '#type' => 'component',
            '#component' => 'bb_theme:brand',
            '#props' => ['size' => $size],
          ];
          $html = (string) $this->container->get('renderer')->renderInIsolation($brand);
          self::assertStringContainsString('bakers-braid.svg?v=' . $token . '"', $html);
        }
      }
    }
  }

  /**
   * Only the four exact bare theme SVG URIs receive a version query.
   */
  public function testOnlyBareThemeSvgUrisAreVersioned(): void {
    $this->container->get('state')->set(
      AssetQueryString::STATE_KEY, 'boundary',
    );
    $handler = $this->container->get('module_handler');
    foreach (['dist/assets/icons/sprite.svg', 'assets/brand/bakers-braid.svg'] as $asset) {
      foreach (['', '/'] as $prefix) {
        $uri = $prefix . 'themes/custom/bb_theme/' . $asset;
        $expected = $uri . '?v=boundary';
        $handler->alter('file_url', $uri);
        self::assertSame($expected, $uri);
        $handler->alter('file_url', $uri);
        self::assertSame($expected, $uri);
      }
    }
    foreach ([
      '/themes/custom/bb_theme/dist/js/skin.js',
      '/themes/custom/bb_theme/dist/css/base.css',
      '/themes/custom/other/assets/brand/bakers-braid.svg',
      'https://example.test/themes/custom/bb_theme/assets/brand/bakers-braid.svg',
      '//example.test/themes/custom/bb_theme/assets/brand/bakers-braid.svg',
      'public://bakers-braid.svg',
      '/themes/custom/bb_theme/assets/brand/bakers-braid.svg?other=1',
      '/themes/custom/bb_theme/dist/assets/icons/sprite.svg#plus',
    ] as $original) {
      $uri = $original;
      $handler->alter('file_url', $uri);
      self::assertSame($original, $uri);
    }
  }

  /**
   * The two shipped copies of the projects view, keyed by where they came from.
   *
   * @return array<string, array<string, mixed>>
   *   The parsed YAML of each copy.
   */
  private function shippedProjectsViewCopies(): array {
    $root = dirname(__DIR__, 7);
    $paths = [
      'config/sync' => $root . '/config/sync/views.view.projects.yml',
      'recipes/bakers/config' => $root . '/recipes/bakers/config/views.view.projects.yml',
    ];
    // THE THIRD PLACE IS ASSERTED AS AN ABSENCE, because "the list no longer
    // names it" is not a check: a re-added file would sail through a helper
    // that simply stopped looking. A module may not ship config whose schema
    // comes from a non-dependency, and this file now carries one.
    self::assertFileDoesNotExist(
      $root . '/web/modules/custom/bb_core/config/optional/views.view.projects.yml',
      'bb_core may not ship a view carrying display_builder-owned config.',
    );

    $copies = [];
    foreach ($paths as $where => $path) {
      self::assertFileExists($path, "$where does not ship views.view.projects.");
      $data = Yaml::parseFile($path);
      self::assertIsArray($data, "$where did not parse as a YAML mapping.");
      $copies[$where] = $data;
    }

    return $copies;
  }

  /**
   * The source's own answer, with the request pushed as a browser sends it.
   *
   * @param string $query
   *   The screen's query string, without a leading `?`.
   *
   * @return array<string, mixed>
   *   The prop value.
   */
  private function actionValue(string $query = ''): array {
    return $this->onTheScreen(
      $query,
      fn (): mixed => $this->createActionSource()->getPropValue(),
    );
  }

  /**
   * The source, rendered.
   *
   * @param string $query
   *   The screen's query string, without a leading `?`.
   *
   * @return string
   *   The markup, which is the empty string when nothing is offered.
   */
  private function actionMarkup(string $query = ''): string {
    return $this->onTheScreen($query, function (): string {
      $build = $this->createActionSource()->getPropValue();
      self::assertIsArray($build);

      return (string) $this->container->get('renderer')->renderInIsolation($build);
    });
  }

  /**
   * Runs a callback with the projects screen's own request on the stack.
   *
   * THE ROUTE MATCH IS PART OF THE REQUEST, and without it this harness is not
   * the one production runs: `BbWorkspaceRouteProcessor` fills the create
   * route's `{bb_workspace}` slot from the workspace the CURRENT route
   * matched, so a request pushed without a match falls back to the default slug
   * and this file would be measuring the fallback. `matchRequest()` also runs
   * the inbound path processor, so the public `/{slug}/projects` is what is
   * pushed — exactly the address a browser is on.
   *
   * @param string $query
   *   The screen's query string, without a leading `?`.
   * @param callable $measure
   *   The callback to run.
   *
   * @return mixed
   *   Whatever the callback returned.
   */
  private function onTheScreen(string $query, callable $measure): mixed {
    $request = Request::create(
      '/' . self::WORKSPACE_SLUG . self::PATH . ($query === '' ? '' : '?' . $query)
    );
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current !== NULL && $current->hasSession()) {
      $request->setSession($current->getSession());
    }
    else {
      $request->setSession(new Session(new MockArraySessionStorage()));
    }
    $request->attributes->add(
      $this->container->get('router')->matchRequest($request)
    );
    $this->container->get('request_stack')->push($request);
    try {
      return $measure();
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
  }

  /**
   * A fresh trigger source, reading the request and the account as they are.
   *
   * Configured through `SourcePluginBase::buildConfiguration()` — the factory
   * `ComponentElementBuilder` itself calls — rather than by hand-assembling
   * the array, and the prop definition is READ from the `slot` PropType so
   * this test cannot pass against a shape the product no longer has.
   */
  private function createActionSource(): ProjectCreateActionSource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_project_create_action',
        SourcePluginBase::buildConfiguration('actions', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(ProjectCreateActionSource::class, $source);

    return $source;
  }

  /**
   * The trigger's own anchor, cut out of the rendered markup.
   *
   * @param string $markup
   *   The rendered trigger.
   *
   * @return string
   *   The anchor's opening tag.
   */
  private function anchorOf(string $markup): string {
    $at = strpos($markup, 'aria-label="New project"');
    self::assertNotFalse($at, 'The trigger did not render.');
    $start = strrpos(substr($markup, 0, $at), '<a ');
    self::assertNotFalse($start, 'The trigger did not render as an anchor.');
    $end = strpos($markup, '>', $at);
    self::assertNotFalse($end);

    return substr($markup, $start, $end - $start);
  }

  /**
   * The address the trigger points at.
   *
   * @param string $markup
   *   The rendered trigger.
   *
   * @return string
   *   The decoded href.
   */
  private function hrefOf(string $markup): string {
    $matched = preg_match('@href="([^"]+)"@', $this->anchorOf($markup), $matches);
    self::assertSame(1, $matched, 'The trigger carries no address.');

    return html_entity_decode($matches[1]);
  }

  /**
   * A workspace guest: may view the screen, may not create through its route.
   */
  private function asWorkspaceGuest(): void {
    $this->asAccountWith(['view bb_project']);
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
   * `administer bakers` is in every list because the SCREEN's route is
   * access-checked before this trigger is ever built:
   * `_bb_workspace_match` answers 403 for an account outside the workspace's
   * read scope, and `matchRequest()` runs that check — measured here as
   * `bb_core.workspace_mismatch`. `view bb_project` is beside it for the
   * second half of the same check — the route's own `_permission` — and both
   * are what the reader looking at this screen already holds. Neither grants
   * `create bb_project`, which is asserted below, so a future permission that
   * folded them together cannot make the negative case pass by accident.
   *
   * @param array<string> $permissions
   *   The permissions to grant.
   */
  private function asAccountWith(array $permissions): void {
    $account = $this->createUser($permissions);
    self::assertInstanceOf(UserInterface::class, $account);
    self::assertSame(
      in_array('create bb_project', $permissions, TRUE),
      $account->hasPermission('create bb_project'),
      'The fixture must not grant the gated permission by a side door.',
    );
    $this->setCurrentUser($account);
  }

}
