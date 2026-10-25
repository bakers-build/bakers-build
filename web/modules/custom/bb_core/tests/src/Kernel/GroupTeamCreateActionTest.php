<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\HttpFoundation\Session\Session;
use Drupal\Core\Template\Attribute;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\ui_patterns\SourcePluginBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Yaml\Yaml;

/**
 * The source plugins and their production placements open shared dialogs.
 */
#[Group('bb_core')]
final class GroupTeamCreateActionTest extends KernelTestBase {

  use ProjectsViewTestTrait;
  use UserCreationTrait;

  /**
   * The workspace both listing routes are entered with.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'field', 'options', 'text', 'filter', 'link', 'entity',
    'markdown_easy', 'og', 'state_machine', 'views', 'better_exposed_filters', 'island',
    'ui_patterns', 'ui_patterns_views', 'display_builder',
    'display_builder_views', 'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team', 'bb_project'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'views']);
    $this->installShippedView('views.view.projects');
    $this->installShippedView('views.view.groups');
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->createUser([], 'uid1-dummy');
    $account = $this->createUser(['administer bakers', 'create bb_group', 'create bb_team']);
    self::assertNotFalse($account);
    $this->setCurrentUser($account);
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create([
      'name' => 'A',
      'slug' => 'workspace-a',
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $this->container->get('router.builder')->rebuild();
    $this->enterRoute('view.projects.workspace_list');
  }

  /**
   * Puts the current request on one of the two listing routes.
   *
   * Both create triggers now hang off the shell's shared `page_header`, so the
   * route is what decides which of them renders: the group trigger has to be
   * asked on its own screen rather than on whichever one setUp happened to
   * push.
   */
  private function enterRoute(string $route): void {
    $path = $route === 'view.groups.workspace_list' ? '/workspace-a/groups' : '/workspace-a/projects';
    $request = Request::create($path);
    $request->setSession(new Session(new MockArraySessionStorage()));
    $request->attributes->add([
      '_route' => $route,
      '_route_object' => $this->container->get('router.route_provider')->getRouteByName($route),
      'bb_workspace' => $this->workspace,
    ]);
    $this->container->get('request_stack')->push($request);
  }

  /**
   * Both action plugins address their real routes and the shared overlay.
   */
  public function testBothActionsOpenTheirRoutedDialogs(): void {
    foreach (['group' => 'New group', 'team' => 'New team'] as $type => $label) {
      if ($type === 'group') {
        $this->enterRoute('view.groups.workspace_list');
      }
      $build = $this->source('bb_' . $type . '_create_action', 'slot')->getPropValue();
      self::assertSame('bb_theme:button', $build['#component']);
      self::assertSame($label, $build['#props']['label']);
      self::assertStringContainsString('/workspace-a/' . $type . '/create', $build['#props']['href']);
      $attributes = (string) $build['#props']['attributes'];
      self::assertStringContainsString('hx-target="#bakers-overlay"', $attributes);
      self::assertStringContainsString('hx-select="dialog:not(dialog dialog)"', $attributes);
      self::assertStringContainsString('_wrapper_format=island_dialog', $attributes);
    }
  }

  /**
   * The real rail source offers creation even before the first team exists.
   */
  public function testEmptyRailPlacesTeamActionAndBubblesItsDependencies(): void {
    $rail = $this->source('bb_menu', 'links', ['menu' => 'bakers-rail']);
    $component = $rail->alterComponent([]);
    $items = $rail->getPropValue();
    $teams = array_values(array_filter($items, static fn (array $item): bool => $item['title'] === 'Teams'));
    self::assertCount(1, $teams);
    self::assertSame([], $teams[0]['below']);
    self::assertSame('New team', $teams[0]['action']['label']);
    self::assertContains('core/drupal.htmx', $component['#attached']['library']);
    self::assertContains('og_membership_list', $component['#cache']['tags']);
  }

  /**
   * Both installation paths place the group action in the shared page header.
   *
   * IT USED TO BE IN THE LISTING ZONE, and that is what the second review pass
   * measured on the running pages: Projects put its plus beside the heading and
   * Groups put its own one row lower, so two lists of the same kind read as two
   * kinds of screen. The container is therefore asserted rather than merely the
   * presence of a trigger, and it is asserted as an absence from the View too —
   * the same trigger in both places would show two pluses.
   */
  public function testTheGroupActionSitsInTheSharedPageHeader(): void {
    foreach (['recipes/bakers/config', 'config/sync'] as $path) {
      $root = dirname(__DIR__, 7) . '/' . $path;
      $canvas = Yaml::parseFile($root . '/views.view.groups.yml')['display']['workspace_list']['display_options']['display_extenders']['display_builder']['sources'][0]['source']['component'];
      self::assertSame('bb_theme:zone', $canvas['component_id']);
      self::assertArrayNotHasKey('actions', $canvas['slots'] ?? []);
      // The search-and-sort toolbar (a `filters` component) leads; the exposed
      // form it binds to follows the pager, holding only hidden parts.
      self::assertSame(
        ['component', 'view_rows', 'view_pager', 'view_exposed'],
        array_column($canvas['slots']['content']['sources'] ?? [], 'source_id'),
      );
      self::assertArrayNotHasKey('heading', $canvas['slots'] ?? []);

      $header = Yaml::parseFile($root . '/island.profile.bb_shell.yml')['placements']['shell_page_header']['configuration']['component'];
      self::assertSame('bb_theme:page_header', $header['component_id']);
      self::assertSame(
        [
          'bb_ticket_create_action',
          'bb_project_create_action',
          'bb_ticket_template_create_action',
          'bb_term_create_action',
          'bb_ticket_trigger_create_action',
          'bb_group_create_action',
          'bb_worklog_create_action',
          'bb_track_billing_account_create_action',
          'bb_service_account_create_action',
        ],
        array_column($header['slots']['actions']['sources'], 'source_id'),
      );
    }
  }

  /**
   * The header trigger keeps itself off every screen but the Groups listing.
   */
  public function testTheGroupActionRendersNothingOnTheProjectsListing(): void {
    $build = $this->source('bb_group_create_action', 'slot')->getPropValue();
    self::assertArrayNotHasKey('#component', $build);

    $this->enterRoute('view.groups.workspace_list');
    self::assertSame('bb_theme:button', $this->source('bb_group_create_action', 'slot')->getPropValue()['#component']);
  }

  /**
   * Drupal's real SDC renderer preserves nav link and HTMX action attributes.
   */
  public function testNavRendersActionAsAccessibleLink(): void {
    foreach ([[], [['title' => 'Existing team', 'url' => '/workspace-a/team/1']]] as $below) {
      $build = [
        '#type' => 'component',
        '#component' => 'bb_theme:nav',
        '#props' => [
          'items' => [[
            'title' => 'Teams',
            'heading' => TRUE,
            'open' => TRUE,
            'below' => $below,
            'action' => [
              'label' => 'New team',
              'icon' => 'plus',
              'href' => '/workspace-a/team/create',
              'attributes' => new Attribute([
                'hx-get' => '/workspace-a/team/create?_wrapper_format=island_dialog',
                'hx-target' => '#bakers-overlay',
                'hx-select' => 'dialog',
              ]),
            ],
          ],
          ],
        ],
      ];
      $markup = (string) $this->container->get('renderer')->renderInIsolation($build);
      self::assertMatchesRegularExpression('/<a[^>]+aria-label="New team"/', $markup);
      self::assertStringContainsString('href="/workspace-a/team/create"', $markup);
      self::assertStringContainsString('hx-target="#bakers-overlay"', $markup);
      self::assertStringContainsString('hx-select="dialog"', $markup);
    }
  }

  /**
   * Instantiates a source through the same configuration factory as rendering.
   */
  private function source(string $id, string $prop_type, array $settings = []): SourcePluginBase {
    $schema = $this->container->get('plugin.manager.ui_patterns_prop_type')->getDefinition($prop_type)['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')->createInstance($id, SourcePluginBase::buildConfiguration('items', $schema, ['source' => $settings], []));
    self::assertInstanceOf(SourcePluginBase::class, $source);
    return $source;
  }

}
