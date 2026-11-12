<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\BbMenuSource;
use Drupal\user\UserInterface;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The `bb_menu` source over the `bakers-rail` and `bakers-account` menus.
 *
 * Most cases run as uid 1, so that access is never the reason a team is
 * absent and the tenancy negatives measure the ambient-workspace guard. The
 * permission and membership denials have their own cases.
 *
 * My work and Settings are absent here: My work's route belongs to the
 * tickets view, which `BbRailMyWorkTest` installs, and Settings is fenced
 * to the workspace's own lead, which uid 1 is not. Insights is present: its
 * workspace permission check honours the super user, as core does.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbMenuSourceTest extends KernelTestBase {

  use UserCreationTrait;
  use TicketNavigationViewsTrait;
  use RailRequestTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns',
    'bb_core', 'views',
  ];

  /**
   * The ambient workspace of every positive case below.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * A second workspace, created up front.
   *
   * The path processor memoises the slug set per request.
   */
  private BbWorkspaceInterface $rival;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('og_membership');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('bb_team');
    $this->installEntitySchema('bb_group');
    $this->installEntitySchema('bb_project');
    $this->installConfig(['system', 'user']);
    $this->setUpCurrentUser(['uid' => 1]);

    $this->installTicketNavigationViews();
    $this->installListingPageDisplays();
    $this->container->get('router.builder')->rebuild();

    $this->workspace = $this->createWorkspace('Acme', 'acme');
    $this->rival = $this->createWorkspace('Rival', 'rival');
    $this->visit('view.groups.workspace_list', ['bb_workspace' => 'acme']);
  }

  /**
   * Groups and Projects carry the workspace slug, in that order.
   */
  public function testRailListsGroupsThenProjects(): void {
    $by_title = array_column($this->emitted(), NULL, 'title');
    self::assertSame('/acme/groups', $by_title['Groups']['url']);
    self::assertSame('/acme/projects', $by_title['Projects']['url']);
    self::assertSame(['Groups', 'Projects', 'Insights', 'Teams'], array_keys($by_title));
  }

  /**
   * Same route, two workspaces: different hrefs and different cache tags.
   */
  public function testTwoWorkspacesOnTheSameRouteNameDifferAndCarryDistinctCacheTags(): void {
    $here = array_column($this->emitted(), 'url', 'title');
    $here_tags = CacheableMetadata::createFromRenderArray($this->source()->alterComponent([]))->getCacheTags();

    $this->visit('view.groups.workspace_list', ['bb_workspace' => 'rival']);
    $there = array_column($this->emitted(), 'url', 'title');
    $there_tags = CacheableMetadata::createFromRenderArray($this->source()->alterComponent([]))->getCacheTags();

    self::assertSame('/acme/groups', $here['Groups']);
    self::assertSame('/rival/groups', $there['Groups']);
    self::assertContains('bb_workspace:' . $this->workspace->id(), $here_tags);
    self::assertNotContains('bb_workspace:' . $this->workspace->id(), $there_tags);
  }

  /**
   * Conductors and Machines are account-area destinations, not rail rows.
   */
  public function testRailDoesNotListConductors(): void {
    $titles = array_column($this->emitted(), 'title');
    self::assertNotContains('Conductors', $titles);
    self::assertNotContains('Machines', $titles);
  }

  /**
   * The account menu: order, URLs, icons, active entry and owner-only rows.
   */
  public function testAccountMenu(): void {
    $this->installUserAreaListingDisplays();
    $titles = ['Account', 'Conductors', 'Machines', 'Workspaces', 'Log out'];

    $this->visit('entity.user.canonical', ['user' => 1]);
    $items = $this->emitted('bakers-account');
    self::assertSame($titles, array_column($items, 'title'));
    self::assertSame(['/user/1', '/user/1/conductors', '/user/1/machines', '/home', '/user/logout/confirm'], array_column($items, 'url'));
    self::assertSame(['settings', 'conductor', 'machine', 'dashboard', 'log-out'], array_column($items, 'icon'));
    self::assertSame([TRUE, FALSE, FALSE, FALSE, FALSE], array_column($items, 'in_active_trail'));
    self::assertTrue($items[3]['full_page']);
    self::assertTrue($items[3]['at_end']);
    self::assertTrue($items[4]['full_page']);

    // Views routes carry the raw uid in {user}.
    $this->visit('view.conductors.user_list', ['user' => 1]);
    self::assertSame([FALSE, TRUE, FALSE, FALSE, FALSE], array_column($this->emitted('bakers-account'), 'in_active_trail'));

    // `active_routes`: the edit form marks Account current.
    $this->visit('entity.user.edit_form', ['user' => 1]);
    self::assertSame([TRUE, FALSE, FALSE, FALSE, FALSE], array_column($this->emitted('bakers-account'), 'in_active_trail'));

    // `active_routes`: a machine's page marks Machines current.
    $this->installEntitySchema('bb_machine');
    $machine = $this->container->get('entity_type.manager')->getStorage('bb_machine')->create([
      'name' => 'Alpha',
      'host_key' => 'host-alpha',
      'owner_user_id' => 1,
      'max_parallel' => 1,
    ]);
    $machine->save();
    $this->visit('entity.bb_machine.canonical', ['user' => 1, 'bb_machine' => $machine->id()]);
    self::assertSame([FALSE, FALSE, TRUE, FALSE, FALSE], array_column($this->emitted('bakers-account'), 'in_active_trail'));

    // Another account's page: its own URLs, no owner-only rows.
    $other = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $other);
    $this->visit('view.conductors.user_list', ['user' => $other->id()]);
    $items = $this->emitted('bakers-account');
    self::assertSame(['Account', 'Conductors', 'Machines'], array_column($items, 'title'));
    self::assertSame('/user/' . $other->id() . '/conductors', $items[1]['url']);
  }

  /**
   * Off a workspace route there are no workspace rows.
   */
  public function testNoProjectsEntryOffWorkspaceRoute(): void {
    self::assertContains('Projects', array_column($this->emitted(), 'title'));

    $this->visit('bb_core.home');

    self::assertSame([], $this->emitted());
  }

  /**
   * An account that may not reach a screen is offered no link to it.
   */
  public function testNoProjectsEntryWithoutPermission(): void {
    self::assertContains('Projects', array_column($this->emitted(), 'title'));

    $this->setUpCurrentUser(['name' => 'permissionless'], []);

    $titles = array_column($this->emitted(), 'title');
    self::assertNotContains('Projects', $titles);
    self::assertNotContains('Groups', $titles);
  }

  /**
   * The entry whose page the request is on is current, and only that one.
   */
  public function testGroupsIsTheActiveEntryOnItsOwnRoute(): void {
    self::assertSame(['Groups' => TRUE, 'Projects' => FALSE, 'Insights' => FALSE, 'Teams' => FALSE], array_column($this->emitted(), 'in_active_trail', 'title'));

    $this->visit('view.projects.workspace_list', ['bb_workspace' => 'acme']);
    self::assertSame(['Groups' => FALSE, 'Projects' => TRUE, 'Insights' => FALSE, 'Teams' => FALSE], array_column($this->emitted(), 'in_active_trail', 'title'));
  }

  /**
   * The rendered nav marks the current entry with `aria-current`.
   */
  public function testRenderedNavMarksTheCurrentEntry(): void {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:nav',
      '#props' => ['items' => $this->emitted()],
    ];
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);

    self::assertMatchesRegularExpression('#<a[^>]*href="/acme/groups"[^>]*aria-current="page"#', $html);
    self::assertDoesNotMatchRegularExpression('#<a[^>]*href="/acme/projects"[^>]*aria-current#', $html);
  }

  /**
   * Groups, Projects, Insights, then the Teams heading.
   */
  public function testTheRowsComeOutInTheAgreedOrder(): void {
    $this->createTeam('Platform Crew');

    $items = $this->emitted();

    self::assertSame(['Groups', 'Projects', 'Insights', 'Teams'], array_column($items, 'title'));
    self::assertArrayNotHasKey('heading', $items[0]);
    self::assertTrue($items[3]['heading']);
    self::assertTrue($items[3]['open']);
    self::assertArrayNotHasKey('url', $items[3]);
    self::assertSame('team', $items[3]['icon']);
  }

  /**
   * Destination rows carry the icon the collapsed rail keeps.
   */
  public function testDestinationRowsCarryTheCollapsedRailIcons(): void {
    self::assertSame(['Groups' => 'dashboard', 'Projects' => 'project', 'Insights' => 'report', 'Teams' => 'team'], array_column($this->emitted(), 'icon', 'title'));
  }

  /**
   * Team rows carry a mark, which the collapsed rail shows for them.
   */
  public function testTeamRowsCarryMarks(): void {
    $team = $this->createTeam('Platform Crew');
    $colors = ['running', 'attention', 'unassigned', 'lease', 'offline'];
    self::assertSame(
      ['initials' => 'PC', 'color' => $colors[(int) $team->id() % 5]],
      $this->teamsGroup()['below'][0]['mark'] ?? NULL,
    );
  }

  /**
   * One entry per team of the ambient workspace, in label order.
   */
  public function testEveryTeamOfTheWorkspaceIsEmittedInLabelOrder(): void {
    $this->createTeam('Zeta Crew');
    $this->createTeam('Alpha Crew');

    self::assertSame(['Alpha Crew', 'Zeta Crew'], array_column($this->teamsGroup()['below'], 'title'));
  }

  /**
   * Every team row links to the team and to its Tickets task.
   */
  public function testEveryTeamLinksToItsTicketsTask(): void {
    $team = $this->createTeam('Platform Crew');

    $teams = $this->teamsGroup()['below'];

    self::assertCount(1, $teams);
    self::assertSame('/acme/team/' . $team->id(), $teams[0]['url']);
    self::assertSame(['Tickets'], array_column($teams[0]['below'], 'title'));
    self::assertSame('/acme/team/' . $team->id() . '/tickets', $teams[0]['below'][0]['url']);
  }

  /**
   * A project route exposes that project's Tickets task under Projects.
   *
   * As the workspace's lead: the Tickets route is access-checked, and the
   * rank fence refuses uid 1 without a membership.
   */
  public function testCurrentProjectLinksToItsTicketsTask(): void {
    $this->installOgScopeFixture();
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $project = $this->createProject($this->createTeam('Platform Crew'));
    self::assertSame([], $this->projectsRow()['below'], 'No project on the route, no Tickets child.');

    $this->visit('entity.bb_project.canonical', ['bb_workspace' => 'acme', 'bb_project' => $project->id()]);

    $below = $this->projectsRow()['below'];
    self::assertSame(['Tickets'], array_column($below, 'title'));
    self::assertSame('/acme/project/' . $project->id() . '/tickets', $below[0]['url']);
    self::assertFalse($below[0]['in_active_trail']);
  }

  /**
   * A project's Overview and Board both keep Projects current and open.
   *
   * The Board is a Views page route carrying the project; the Tickets child
   * stays inactive there.
   */
  public function testProjectsIsActiveOnOverviewAndBoard(): void {
    $this->installOgScopeFixture();
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $project = $this->createProject($this->createTeam('Platform Crew'));
    $this->installProjectBoardDisplay();

    foreach (['entity.bb_project.canonical', 'view.project_board.project_board'] as $route) {
      $this->visit($route, ['bb_workspace' => 'acme', 'bb_project' => $project->id()]);

      $projects = $this->projectsRow();
      self::assertTrue($projects['in_active_trail'], $route);
      self::assertSame(['Tickets'], array_column($projects['below'], 'title'), $route);
      self::assertFalse($projects['below'][0]['in_active_trail'], $route);
    }
  }

  /**
   * Registers the project Board page display for the rail's active routes.
   */
  private function installProjectBoardDisplay(): void {
    View::create([
      'id' => 'project_board',
      'label' => 'project_board',
      'base_table' => 'bb_project',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => [
            'access' => ['type' => 'none'],
          ],
        ],
        'project_board' => [
          'id' => 'project_board',
          'display_title' => 'Project board',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/project/%bb_project/board',
            'access' => ['type' => 'none'],
          ],
        ],
      ],
    ])->save();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * On a project's Tickets task, Projects is in the trail and its panel open.
   */
  public function testProjectTicketsTaskKeepsProjectsInTheTrail(): void {
    $this->installOgScopeFixture();
    $lead = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $lead);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $this->setCurrentUser($lead);
    $project = $this->createProject($this->createTeam('Platform Crew'));

    $this->visit('view.tickets.project_tickets', ['bb_workspace' => 'acme', 'bb_project' => $project->id()]);

    $projects = $this->projectsRow();
    self::assertTrue($projects['in_active_trail']);
    self::assertTrue($projects['below'][0]['in_active_trail']);

    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:nav',
      '#props' => ['items' => $this->emitted()],
    ];
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    self::assertMatchesRegularExpression('#aria-expanded="true"\s+aria-label="Projects sub-navigation"#', $html);
  }

  /**
   * The team the request is on is in the active trail, on any of its tabs.
   */
  public function testTheTeamTheRequestIsOnIsInTheActiveTrail(): void {
    $platform = $this->createTeam('Platform Crew');
    $this->createTeam('Design Crew');

    $this->visit('bb_core.bb_team.members', ['bb_workspace' => 'acme', 'bb_team' => $platform->id()]);

    self::assertSame(
      ['Design Crew' => FALSE, 'Platform Crew' => TRUE],
      array_column($this->teamsGroup()['below'], 'in_active_trail', 'title'),
    );
  }

  /**
   * An authorized operator can create the first team in an empty workspace.
   */
  public function testWorkspaceWithoutTeamsOffersCreation(): void {
    $items = $this->emitted();
    self::assertSame(['Groups', 'Projects', 'Insights', 'Teams'], array_column($items, 'title'));
    self::assertSame([], $items[3]['below']);
    self::assertSame('New team', $items[3]['action']['label']);
    self::assertSame('plus', $items[3]['action']['icon']);
  }

  /**
   * Off a workspace route no team is disclosed, by any key.
   */
  public function testNoTeamIsDisclosedOffWorkspaceRoutes(): void {
    $this->createTeam('Platform Crew');
    $this->visit('bb_core.home');

    $items = $this->emitted();

    self::assertSame([], $items);
    self::assertStringNotContainsStringIgnoringCase('Crew', json_encode($items, JSON_THROW_ON_ERROR));
  }

  /**
   * Another workspace's teams stay out.
   */
  public function testTeamsOfAnotherWorkspaceAreNotDisclosed(): void {
    $this->createTeam('Ours Crew');
    $this->createTeam('Theirs Crew', $this->rival);

    self::assertSame(['Ours Crew'], array_column($this->teamsGroup()['below'], 'title'));
  }

  /**
   * Insights sits between Projects and Settings, for the workspace lead only.
   */
  public function testInsightsRailEntryOnlyForLeads(): void {
    $this->installOgScopeFixture();
    $lead = $this->setUpCurrentUser(['name' => 'acme-lead']);
    $this->addMembership($this->workspace, $lead, ['lead']);
    $titles = array_column($this->emitted(), 'title');
    self::assertSame(['Insights', 'Settings'], array_values(array_intersect($titles, ['Insights', 'Settings'])));
    $insights = array_column($this->emitted(), NULL, 'title')['Insights'];
    self::assertSame('/acme/insights', $insights['url']);
    self::assertFalse($insights['in_active_trail']);

    $this->visit('bb_core.workspace.insights', ['bb_workspace' => 'acme']);
    self::assertTrue(array_column($this->emitted(), NULL, 'title')['Insights']['in_active_trail']);

    $contributor = $this->setUpCurrentUser(['name' => 'acme-contributor']);
    $this->addMembership($this->workspace, $contributor, ['contributor']);
    self::assertNotContains('Insights', array_column($this->emitted(), 'title'));
  }

  /**
   * An account without membership sees no team and no empty Teams heading.
   */
  public function testTeamIsDeniedToAnAccountWithNoMembership(): void {
    $this->createTeam('Platform Crew');
    $this->setUpCurrentUser(['name' => 'outsider'], []);

    self::assertStringNotContainsStringIgnoringCase('Crew', json_encode($this->emitted(), JSON_THROW_ON_ERROR));
    self::assertNotContains('Teams', array_column($this->emitted(), 'title'));
  }

  /**
   * A fresh instance's `alterComponent()` declares every cache term.
   *
   * Contrib calls it on its own instance before the value is resolved, so
   * nothing may depend on `getPropValue()` having run first.
   */
  public function testAlterComponentAloneDeclaresTheCacheability(): void {
    foreach (['bakers-rail', 'bakers-account'] as $menu) {
      $cache = CacheableMetadata::createFromRenderArray($this->source($menu)->alterComponent([]));
      foreach (['bb_team_list', 'og_membership_list', 'bb_workspace_list', 'config:system.menu.' . $menu] as $tag) {
        self::assertContains($tag, $cache->getCacheTags(), "$menu: $tag");
      }
      foreach (['user', 'user.permissions', 'route', 'url.query_args:workspace'] as $context) {
        self::assertContains($context, $cache->getCacheContexts(), "$menu: $context");
      }
    }
  }

  /**
   * The Teams heading of the emitted value.
   *
   * @return array<string, mixed>
   *   The heading item.
   */
  private function teamsGroup(): array {
    foreach ($this->emitted() as $item) {
      if (($item['heading'] ?? FALSE) === TRUE) {
        return $item;
      }
    }
    self::fail('The emitted rail carries no Teams heading.');
  }

  /**
   * The Projects row of the emitted value.
   *
   * @return array<string, mixed>
   *   The Projects item.
   */
  private function projectsRow(): array {
    $by_title = array_column($this->emitted(), NULL, 'title');
    self::assertArrayHasKey('Projects', $by_title);
    return $by_title['Projects'];
  }

  /**
   * The source's emitted value on the current route.
   *
   * @return array<int, array<string, mixed>>
   *   Link items in the `links` vocabulary.
   */
  private function emitted(string $menu = 'bakers-rail'): array {
    $value = $this->source($menu)->getPropValue();
    self::assertIsArray($value);
    return array_values($value);
  }

  /**
   * A fresh `bb_menu` source, configured the way the builder configures it.
   */
  private function source(string $menu = 'bakers-rail'): BbMenuSource {
    $prop_definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('links')['schema'];
    $configuration = SourcePluginBase::buildConfiguration('items', $prop_definition, ['source' => ['menu' => $menu]], []);
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance('bb_menu', $configuration);
    self::assertInstanceOf(BbMenuSource::class, $source);
    return $source;
  }

  /**
   * Creates a workspace.
   */
  private function createWorkspace(string $name, string $slug): BbWorkspaceInterface {
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => $name, 'slug' => $slug]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    return $workspace;
  }

  /**
   * Registers Groups and Projects page displays for rail links.
   */
  private function installListingPageDisplays(): void {
    foreach ([
      'projects' => ['_workspace/%bb_workspace/projects', 'view bb_project', 'bb_project'],
      'groups' => ['_workspace/%bb_workspace/groups', 'view bb_group', 'bb_group'],
    ] as $id => [$path, $perm, $base]) {
      View::create([
        'id' => $id,
        'label' => $id,
        'base_table' => $base,
        'display' => [
          'default' => [
            'id' => 'default',
            'display_title' => 'Default',
            'display_plugin' => 'default',
            'position' => 0,
            'display_options' => [
              'access' => ['type' => 'perm', 'options' => ['perm' => $perm]],
            ],
          ],
          'workspace_list' => [
            'id' => 'workspace_list',
            'display_title' => 'Workspace list',
            'display_plugin' => 'page',
            'position' => 1,
            'display_options' => [
              'path' => $path,
              'access' => ['type' => 'perm', 'options' => ['perm' => $perm]],
            ],
          ],
        ],
      ])->save();
    }
  }

  /**
   * Creates a team, by default in the ambient workspace.
   */
  private function createTeam(string $name, ?BbWorkspaceInterface $workspace = NULL): BbTeamInterface {
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => $name, 'workspace_id' => ($workspace ?? $this->workspace)->id()]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $team->save();
    return $team;
  }

  /**
   * Creates a project assigned to a team in the ambient workspace.
   */
  private function createProject(BbTeamInterface $team): BbProjectInterface {
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'Platform Group', 'workspace_id' => $this->workspace->id()]);
    $group->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'Platform Project',
        'key' => 'PLAT',
        'group_id' => $group->id(),
        'teams' => [$team->id()],
      ]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $project->save();
    return $project;
  }

  /**
   * Registers the user Conductors and Machines pages for the account menu.
   */
  private function installUserAreaListingDisplays(): void {
    foreach ([
      'conductors' => ['bb_conductor', 'view bb_conductor', 'user/%user/conductors'],
      'machines' => ['bb_machine', 'view bb_machine', 'user/%user/machines'],
    ] as $id => [$base, $perm, $path]) {
      View::create([
        'id' => $id,
        'label' => $id,
        'base_table' => $base,
        'display' => [
          'default' => [
            'id' => 'default',
            'display_title' => 'Default',
            'display_plugin' => 'default',
            'position' => 0,
            'display_options' => [
              'access' => ['type' => 'perm', 'options' => ['perm' => $perm]],
            ],
          ],
          'user_list' => [
            'id' => 'user_list',
            'display_title' => 'User list',
            'display_plugin' => 'page',
            'position' => 1,
            'display_options' => [
              'path' => $path,
              'access' => ['type' => 'perm', 'options' => ['perm' => $perm]],
            ],
          ],
        ],
      ])->save();
    }
    $this->container->get('router.builder')->rebuild();
  }

}
