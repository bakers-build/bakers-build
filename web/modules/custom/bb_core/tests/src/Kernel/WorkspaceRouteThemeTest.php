<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Routing\RouteMatch;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Yaml\Yaml;

/**
 * Everything under a workspace prefix renders in the front-end theme (V10).
 *
 * The human's decision during the BB-350 coding run, beyond the spec:
 * `/{workspace}/…` is the product front end, entity EDIT FORMS included. That
 * is not the default outcome. Two mechanisms hand routes to Gin and only one
 * of them reads the path: core's AdminRouteSubscriber stamps `_admin_route` on
 * `/admin/…`, but the entity module's AdminHtmlRouteProvider stamps it by
 * ROUTE NAME — add_page, add_form, edit_form, delete_form,
 * delete_multiple_form, duplicate_form — wherever those routes live. So moving
 * the paths out of /admin fixes canonical and the dashboard by itself and does
 * NOT fix the forms; BbWorkspaceRouteSubscriber has to clear the option.
 *
 * This test is also the safety net for a deletion. BbThemeNegotiator used to
 * force bb_theme on four route names by hand. Once the default theme is what
 * these routes resolve to anyway, that class asserts something untrue and is
 * removed — so this test was written and watched PASS while the negotiator was
 * still installed, then watched pass again after it was deleted. Without the
 * negative control below that would prove nothing, which is why an actual
 * admin route is asserted to resolve to Gin in the same run: the test can tell
 * the two themes apart.
 *
 * Resolution is asked of the real theme negotiator rather than inferred from
 * the `_admin_route` option, because the option is the input and the theme is
 * the claim.
 *
 * The theme pairing is READ FROM `config/sync/system.theme.yml` rather than
 * restated here. Restating it is what made the first version of this test pass
 * while the product was broken: it set `default: bb_theme` itself, so it
 * measured its own assumption on a site whose recipe left the default on
 * `stark`. Reading the shipped value means the test resolves whatever the
 * product actually ships, and it fails the day the two disagree. That the
 * recipe ships the same value is asserted separately, by
 * \Drupal\Tests\bb_core\Unit\ShippedConfigDriftTest — a file comparison,
 * which is the only thing that can catch a drift between two install paths.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WorkspaceRouteThemeTest extends KernelTestBase {

  use UserCreationTrait;
  use RunsNavigationViewsTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'filter', 'markdown_easy', 'link', 'text', 'og',
    'views', 'better_exposed_filters', 'views_autocomplete_filters',
    'ui_patterns', 'ui_patterns_views', 'ui_patterns_field',
    'ui_patterns_field_formatters', 'field_ui', 'display_builder',
    // `display_builder_page_layout` is deliberately NOT enabled. This test is
    // about theme negotiation on routes, and enabling it would install
    // bb_core's optional shell page layout — whose postSave() dereferences
    // the display_builder profile it names, at module-install time, before any
    // setUp() line could put that profile in place. The layout does not
    // declare a config dependency on the profile (contrib calculates none), so
    // nothing orders the two; the cheapest correct answer is not to drag a
    // page layout into a routing test.
    'display_builder_entity_view', 'block',
    // `path_alias` came in transitively while bb_dashboard was enabled here.
    // Its absence surfaces as "non-existent service path_alias.manager" while
    // system's own config installs, which names neither this test nor the
    // module that used to pull it — so it is listed explicitly rather than
    // left to another dependency to supply.
    'path_alias',
    'bb_core',
  ];

  /**
   * The site's front-end theme, as `config/sync` ships it.
   */
  private string $frontEndTheme;

  /**
   * The site's admin theme, as `config/sync` ships it.
   */
  private string $adminTheme;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    // Layer A (BB-359) resolves the account's ranks on every permission
    // check, so any test that boots bb_core needs the membership schema even
    // when it never mentions a group — the same requirement the BB-318 read
    // scope already put on its own tests (CLAUDE.md › Query access).
    $this->installEntitySchema('og_membership');
    // The shell page layout bb_core now ships (BB-396 D4) is created while
    // this test installs, and PageLayout::postSave() builds a display_builder
    // instance for it. Without the instance schema that fatals as
    // "Call to a member function id() on null" inside contrib, naming neither
    // this test nor the config that triggered it.
    $this->installEntitySchema('display_builder_instance');
    // display_builder's own config, for its `default` profile. The shell page
    // layout names that profile and PageLayout::postSave() dereferences it
    // without a null check, so its absence is a fatal inside contrib rather
    // than a missing-dependency message. Note what this exposes and what this
    // test cannot fix: `page_layout` does NOT calculate a config dependency on
    // the profile it names, even though the schema constrains it with
    // ConfigExists — so nothing but this line makes the ordering hold.
    $this->installConfig(['system', 'user', 'display_builder']);
    // The site's real pairing, taken from the file the server's CIM imports.
    // The two names are read rather than written so this test cannot be right
    // about a theme the product does not actually use.
    $shipped = Yaml::parseFile(dirname(__DIR__, 7) . '/config/sync/system.theme.yml');
    self::assertIsArray($shipped);
    $this->frontEndTheme = (string) ($shipped['default'] ?? '');
    $this->adminTheme = (string) ($shipped['admin'] ?? '');
    self::assertNotSame('', $this->frontEndTheme, 'config/sync names a default theme.');
    self::assertNotSame('', $this->adminTheme, 'config/sync names an admin theme.');
    self::assertNotSame(
      $this->frontEndTheme,
      $this->adminTheme,
      'The two themes differ, or neither assertion below could fail.',
    );

    $this->container->get('theme_installer')
      ->install([$this->frontEndTheme, $this->adminTheme]);
    $this->config('system.theme')
      ->set('default', $this->frontEndTheme)
      ->set('admin', $this->adminTheme)
      ->save();
    // Core's AdminNegotiator only applies to an AUTHENTICATED account holding
    // `view the administration theme`. Without one, every route resolves to
    // the default theme and the negative control below could not fail.
    $this->setUpCurrentUser([], ['view the administration theme']);
    $this->installRunsNavigationViews();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Every workspace-prefixed route resolves to the front-end theme.
   *
   * The edit form is the load-bearing case: it is the one the entity module
   * stamps by route name, so it is the one that would still be Gin if only
   * the paths had moved.
   */
  public function testWorkspaceRoutesResolveToTheFrontEndTheme(): void {
    foreach ([
      'entity.bb_ticket.canonical',
      'entity.bb_ticket.edit_form',
      'entity.bb_ticket.add_form',
      'entity.bb_ticket.delete_form',
      'entity.bb_project.edit_form',
      // The reference surface, which replaced the three dashboard routes this
      // list used to name (BB-396 retired that module). They are the better
      // fixture rather than merely the available one: the team screen is what
      // the shell now renders, so a theme negotiation that broke would break
      // the surface this property exists to protect.
      'entity.bb_team.canonical',
      'bb_core.bb_team.members',
      'view.runs.team_runs',
      'entity.bb_run.canonical',
      'entity.bb_comment.canonical',
    ] as $route_name) {
      self::assertSame(
        $this->frontEndTheme,
        $this->themeOf($route_name),
        sprintf('%s must render in the product front-end theme.', $route_name),
      );
    }
  }

  /**
   * The negative control: a real admin route still resolves to Gin.
   *
   * Without this the assertion above would also hold on a site with no admin
   * theme at all, and the test would be measuring nothing.
   */
  public function testAdminRoutesStillResolveToTheAdminTheme(): void {
    foreach ([
      'bb_core.settings',
      'entity.bb_workspace.edit_form',
    ] as $route_name) {
      self::assertSame(
        $this->adminTheme,
        $this->themeOf($route_name),
        sprintf('%s is instance administration and must stay in the admin theme.', $route_name),
      );
    }
  }

  /**
   * The workspace routes carry no admin-route option for a negotiator to read.
   *
   * The mechanism behind the assertions above, pinned separately so a failure
   * says which half broke.
   */
  public function testWorkspaceRoutesAreNotAdminRoutes(): void {
    $provider = $this->container->get('router.route_provider');

    foreach ([
      'entity.bb_ticket.edit_form',
      'entity.bb_ticket.delete_form',
      'entity.bb_project.add_form',
      // The reference surface, in place of the dashboard route this list named
      // until BB-396 retired that module.
      'bb_core.bb_team.members',
    ] as $route_name) {
      self::assertFalse(
        (bool) $provider->getRouteByName($route_name)->getOption('_admin_route'),
        sprintf('%s must not be an admin route.', $route_name),
      );
    }
    self::assertTrue(
      (bool) $provider->getRouteByName('entity.bb_workspace.edit_form')->getOption('_admin_route'),
      'The workspace edit form stays instance administration (D2).',
    );
  }

  /**
   * Resolves the active theme for a route, as the real negotiator would.
   *
   * @param string $route_name
   *   The route to resolve.
   *
   * @return string
   *   The active theme name.
   */
  private function themeOf(string $route_name): string {
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $route_match = new RouteMatch($route_name, $route);
    return (string) $this->container->get('theme.negotiator')
      ->determineActiveTheme($route_match);
  }

}
