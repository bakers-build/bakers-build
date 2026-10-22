<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbGroupInterface;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTeamInterface;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/**
 * Drives every place `tests/fixtures/web-ui-sitemap.md` names, once per rank.
 *
 * BB-454's one new test seam. The sitemap file is the DATA this class
 * iterates, not documentation it happens to check: every product route in the
 * "Rail", "Workspace settings", "Project detail" and "Team detail" tables is
 * read out of the file itself, and a row naming a route that does not exist —
 * or a route this module declares that the file does not name — fails the
 * relevant assertion below.
 *
 * A KERNEL test, not a `BrowserTestBase` one, and that is measured rather than
 * a preference: `SIMPLETEST_DB` in `phpunit.xml` is sqlite `:memory:`, which a
 * Kernel test never notices because everything runs in one PHP process, but a
 * `BrowserTestBase` request goes out to the real web server's OWN PHP-FPM
 * process over `SIMPLETEST_BASE_URL` — a second process with its own,
 * different, empty `:memory:` database. Requesting `/user/login` there renders
 * the Drupal INSTALLER, not this test's fixtures, and every login fails.
 * `WorkspaceRouteAccessTest` records the same choice for the same reason: "…
 * requests go through the real http_kernel, so the router, the param
 * converters, the access checks and the exception subscriber all
 * participate — everything a browser test would exercise except the
 * browser." That is exactly what this class needs, and no more.
 *
 * The Views-backed places (`Tickets`, `Runs`, `Board`) are stubbed the way
 * `TicketNavigationViewsTrait`/`RunsNavigationViewsTrait` already stub them: a
 * `View` under the shipped id and paths, based on `users_field_data` rather
 * than the real `search_api` index, because this class asserts route, access
 * and rendering — not search results. Full shipped View coverage is
 * `ConfigCopyDriftTest` (the two copies agree) and the recipe-test install
 * (the index and view both apply).
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class WebUiSitemapStructureTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use TicketNavigationViewsTrait;
  use RunsNavigationViewsTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'island', 'link', 'text', 'views', 'bb_core',
    // The Board tab is bb_board's local task.
    'bb_board',
    // The template's Triggers tab and trigger forms.
    'plugin', 'bb_ticket_trigger',
  ];

  /**
   * The rows read out of the sitemap file, keyed by route name.
   *
   * @var array<string, array{place: string, table: string}>
   */
  private array $rows = [];

  /**
   * The ordered route names of each tab table, for the tab-position check.
   *
   * @var array<string, array<string>>
   */
  private array $tabOrder = [];

  /**
   * The workspace every fixture entity and account belongs to.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * The team the project belongs to.
   */
  private BbTeamInterface $team;

  /**
   * The group the group-detail places are driven against.
   */
  private BbGroupInterface $group;

  /**
   * The project every project-detail row is driven against.
   */
  private BbProjectInterface $project;

  /**
   * The conductor the conductor-detail places are driven against.
   */
  private BbConductorInterface $conductor;

  /**
   * The machine the machine-detail places are driven against.
   */
  private BbMachineInterface $machine;

  /**
   * The four ranked accounts this class drives every place as.
   *
   * @var array<string, \Drupal\user\UserInterface>
   */
  private array $accounts = [];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_invite', 'bb_conductor', 'bb_machine', 'bb_ticket_template',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->installOgScopeFixture();
    // User 1 bypasses every access check; consume that uid so the ranked
    // accounts below are ordinary users whose verdicts this test can measure.
    $this->createAccount('root', []);

    $workspace = $this->create('bb_workspace', ['name' => 'Acme', 'slug' => 'acme']);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $team = $this->create('bb_team', [
      'name' => 'Platform Crew',
      'workspace_id' => $this->workspace->id(),
    ]);
    self::assertInstanceOf(BbTeamInterface::class, $team);
    $this->team = $team;
    $group = $this->create('bb_group', [
      'name' => 'Platform Group',
      'workspace_id' => $this->workspace->id(),
    ]);
    self::assertInstanceOf(BbGroupInterface::class, $group);
    $this->group = $group;
    $project = $this->create('bb_project', [
      'name' => 'Platform Project',
      'key' => 'PLAT',
      'group_id' => $group->id(),
      'teams' => [$this->team->id()],
    ]);
    self::assertInstanceOf(BbProjectInterface::class, $project);
    $this->project = $project;
    $conductor = $this->create('bb_conductor', [
      'conductor_id' => 'reg-sitemap',
      'label' => 'Sitemap conductor',
      'project_id' => $project->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $this->conductor = $conductor;

    $this->installTicketNavigationViews();
    $this->installRunsNavigationViews();
    // The shared trait stubs `project_tickets`/`team_tickets` only; the
    // sitemap's Rail row additionally needs `view.tickets.my_work`.
    $tickets = View::load('tickets');
    self::assertNotNull($tickets);
    $tickets->set('display', $tickets->get('display') + [
      'my_work' => [
        'id' => 'my_work',
        'display_title' => 'My work',
        'display_plugin' => 'page',
        'position' => 3,
        'display_options' => ['path' => '_workspace/%bb_workspace/tickets'],
      ],
    ]);
    $tickets->save();

    // Groups and Projects are Views page displays. Stubbed the same minimal
    // way as the tickets listing — a `workspace_list` page carrying only the
    // shipped access permission and path — so the route renders without the
    // full display-builder tree.
    foreach ([
      'projects' => ['view bb_project', 'bb_project', '_workspace/%bb_workspace/projects'],
      'groups' => ['view bb_group', 'bb_group', '_workspace/%bb_workspace/groups'],
    ] as $id => [$perm, $base, $path]) {
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
            'display_options' => ['access' => ['type' => 'perm', 'options' => ['perm' => $perm]]],
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

    // The addon overview, a workspace settings tab; its own access is none
    // and the route subscriber adds the lead gate. Its rows need bb_addon,
    // which this harness leaves out.
    View::create([
      'id' => 'addons',
      'label' => 'addons',
      'base_table' => 'users_field_data',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => ['access' => ['type' => 'none', 'options' => []]],
        ],
        'settings' => [
          'id' => 'settings',
          'display_title' => 'Addons',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => ['path' => '_workspace/%bb_workspace/settings/addons'],
        ],
      ],
    ])->save();

    View::create([
      'id' => 'project_board',
      'label' => 'project_board',
      'base_table' => 'users_field_data',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => ['access' => ['type' => 'none']],
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

    View::create([
      'id' => 'conductors',
      'label' => 'conductors',
      'base_table' => 'bb_conductor',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => [
            'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_conductor']],
          ],
        ],
        'user_list' => [
          'id' => 'user_list',
          'display_title' => 'User conductors',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => [
            'path' => 'user/%user/conductors',
            'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_conductor']],
          ],
        ],
        'project_list' => [
          'id' => 'project_list',
          'display_title' => 'Project conductors',
          'display_plugin' => 'page',
          'position' => 2,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/project/%bb_project/conductors',
            'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_conductor']],
          ],
        ],
      ],
    ])->save();

    View::create([
      'id' => 'bb_ticket_templates',
      'label' => 'bb_ticket_templates',
      'base_table' => 'bb_ticket_template',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => [
            'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_ticket_template']],
          ],
        ],
        'project_list' => [
          'id' => 'project_list',
          'display_title' => 'Project templates',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/project/%bb_project/templates',
            'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_ticket_template']],
          ],
        ],
        'workspace_list' => [
          'id' => 'workspace_list',
          'display_title' => 'Workspace templates',
          'display_plugin' => 'page',
          'position' => 2,
          'display_options' => [
            'path' => '_workspace/%bb_workspace/settings/templates',
            'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_ticket_template']],
          ],
        ],
      ],
    ])->save();

    View::create([
      'id' => 'machines',
      'label' => 'machines',
      'base_table' => 'bb_machine',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_title' => 'Default',
          'display_plugin' => 'default',
          'position' => 0,
          'display_options' => [
            'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_machine']],
          ],
        ],
        'user_list' => [
          'id' => 'user_list',
          'display_title' => 'User machines',
          'display_plugin' => 'page',
          'position' => 1,
          'display_options' => [
            'path' => 'user/%user/machines',
            'access' => ['type' => 'perm', 'options' => ['perm' => 'view bb_machine']],
          ],
        ],
      ],
    ])->save();

    // THE RANKS ARE lead, contributor, guest — not `member`. BB-462 emptied
    // the workspace `member` role to a bare `required` marker carrying no
    // permission at all, and moved the working rank to `contributor`. Driving
    // `member` here would measure a rank that can do nothing and report it as
    // coverage.
    foreach (['lead', 'contributor', 'guest'] as $rank) {
      $account = $this->createAccount($rank, []);
      $this->addMembership($this->workspace, $account, [$rank]);
      $this->accounts[$rank] = $account;
    }
    $this->accounts['non-member'] = $this->createAccount('non-member', []);

    $machine = $this->create('bb_machine', [
      'name' => 'Sitemap host',
      'host_key' => 'host-sitemap',
      'owner_user_id' => $this->accounts['lead']->id(),
    ]);
    self::assertInstanceOf(BbMachineInterface::class, $machine);
    $this->machine = $machine;

    [$this->rows, $this->tabOrder] = $this->parseSitemap();
    $this->container->get('router.builder')->rebuild();
  }

  /**
   * Every declared place resolves to the status its rank's permissions predict.
   *
   * Read the assertion the other way round too: a route this test does not
   * know how to gate would silently report a false PASS, so every row in
   * `$this->rows` MUST be covered by `expectedStatus()` — a row it cannot
   * classify fails loudly instead.
   */
  public function testEveryPlaceMatchesItsDeclaredGateForEveryRank(): void {
    $observed_non_member = [];
    foreach ($this->rows as $route_name => $row) {
      $path = $this->pathFor($route_name);
      foreach ($this->accounts as $rank => $account) {
        [$status, $content] = $this->requestAs($path, $account);
        if ($rank === 'non-member') {
          $observed_non_member[$route_name] = $status;
          // NON-MEMBER IS A PER-ROUTE LITERAL TOO, NOT A DISJUNCTION
          // (BB-454 round 4 review). This was `assertContains($status,
          // [403, 404])`, which passes on either answer and so cannot see the
          // difference it exists to protect: whether a stranger can tell a
          // place that exists in someone else's workspace from one that does
          // not exist. 403 says it exists; 404 does not.
          //
          // A blanket `assertSame(404, …)` was tried first and MEASURED
          // FALSE — `bb_core.bb_workspace.settings` answers 403. So the
          // rule is neither "always 403" (the original docblock's claim, also
          // measured false) nor "always 404": it depends on whether the
          // route's own check denies neutrally, letting
          // `BbWorkspaceAccessCheck`'s marked forbidden survive
          // `AccessResult::andIf()` and reach
          // `BbWorkspaceNotFoundSubscriber`, or forbids outright and wins
          // the fold. Stating it per route is what makes a change in either
          // direction visible, and each 403 is recorded as the open question
          // it is rather than smoothed away.
          //
          // COLLECTED AND COMPARED AS A WHOLE MAP BELOW, not asserted here.
          // PHPUnit stops a test method at its first failed assertion, so a
          // per-row assertion inside this loop reports exactly one offending
          // route per run and hides the rest — which is how the first attempt
          // at this table came to be revised three times, once per hidden
          // row. One assertion over the full map names every deviation at
          // once.
          continue;
        }
        self::assertSame(
          $this->expectedStatus($route_name, $rank),
          $status,
          sprintf('%s (%s) as %s.', $row['place'], $route_name, $rank),
        );
        if ($status === 200) {
          $this->assertNoPhpErrorOrWarning($content, sprintf('%s as %s', $route_name, $rank));
        }
      }
    }

    // THE NON-MEMBER ROW, AS ONE MAP. Sorted so the comparison is about the
    // statuses rather than about sitemap order.
    $expected_non_member = self::EXPECTED_STATUS_NON_MEMBER;
    ksort($expected_non_member);
    ksort($observed_non_member);
    self::assertSame(
      $expected_non_member,
      $observed_non_member,
      'a stranger sees the declared status on every place — 404 hides that the place exists, 403 admits it.',
    );

    // AND THE TABLE IN THE OTHER DIRECTION. The loop above fails loudly on a
    // row the table cannot classify; this fails on the mirror case, an
    // expectation the loop never drove. Without it, renaming a sitemap row
    // leaves its EXPECTED_STATUS entry behind as dead data that still reads
    // like coverage — the same shape as the reverse route guard in
    // testEveryRouteThisTicketAddsIsInTheFile(), applied to the expectations
    // rather than to the routes.
    self::assertSame(
      [],
      array_values(array_diff(array_keys(self::EXPECTED_STATUS), array_keys($this->rows))),
      'every hard-coded expectation belongs to a place the sitemap still declares.',
    );
    self::assertSame(
      [],
      array_values(array_diff(array_keys(self::EXPECTED_STATUS_NON_MEMBER), array_keys($this->rows))),
      'every hard-coded non-member expectation belongs to a place the sitemap still declares.',
    );
  }

  /**
   * The project tab row is EXACTLY the agreed one, in the agreed order.
   *
   * Read off `plugin.manager.menu.local_task` rather than a full page render:
   * the tab row's HTML is `local_tasks_block`, placed by the shell's ISLAND
   * profile — recipe-shipped config this Kernel test does not install — so the
   * thing under test here is the LOCAL TASK SYSTEM's own answer, which is what
   * that block would display verbatim.
   *
   * THE ROW IS COMPARED WHOLE, AND IT WAS NOT ALWAYS. This assertion used to
   * run the rendered row through a filter that kept only routes the sitemap
   * already named, then compared THAT — so it read as an exactness claim while
   * being a subset claim, and no foreign tab could ever fail it. One had in
   * fact arrived: `og_entity_type_alter()` puts an `og-admin-routes` link
   * template on every entity type in the system, OG's `RouteSubscriber` builds
   * a "Group management" route from each, and `OgLocalTask` derived a tab into
   * this very row — a sixth on team, a seventh on project, invisible to both
   * this test and the Playwright suite, which checks named tabs one at a time.
   * `BbWorkspaceRouteSubscriber::removeOgAdminRoutes()` takes those routes off
   * bakers.build's entity types, and the filter goes with them: what the
   * criterion says is "exactly", so that is what is asserted.
   */
  public function testProjectTabRowMatchesTheAgreedOrder(): void {
    // Asserted BEFORE the `assertSame` below, and against a literal 8 rather
    // than `count($this->tabOrder['Project detail'])`: `parseSitemap()`'s
    // `count($cells) < 6` guard (around line 482) can silently drop a
    // malformed sitemap row from BOTH sides of the comparison at once — the
    // parsed expectation shrinks along with whatever the row named — and
    // `assertSame` on two equally-shrunk arrays would still pass. A literal
    // count is the only side of this assertion the parser cannot also move.
    self::assertCount(
      8,
      $this->tabOrder['Project detail'],
      'The sitemap file must parse exactly eight Project detail tab rows.',
    );
    self::assertSame(
      $this->tabOrder['Project detail'],
      $this->tabRoutesOn('entity.bb_project.canonical', $this->accounts['lead']),
      'The project tab row is exactly the agreed eight, in order.',
    );
  }

  /**
   * The team tab row is EXACTLY the agreed one, in the agreed order.
   *
   * Compared whole, for the reason the project case states at length.
   */
  public function testTeamTabRowMatchesTheAgreedOrder(): void {
    // Same literal-count guard as the project case above, against the
    // parser's silent-drop failure mode rather than the parser's own count.
    self::assertCount(
      5,
      $this->tabOrder['Team detail'],
      'The sitemap file must parse exactly five Team detail tab rows.',
    );
    self::assertSame(
      $this->tabOrder['Team detail'],
      $this->tabRoutesOn('entity.bb_team.canonical', $this->accounts['lead']),
      'The team tab row is exactly the agreed five, in order.',
    );
  }

  /**
   * The group tab row is EXACTLY Overview then Settings.
   *
   * Compared whole, for the reason the project case states at length.
   */
  public function testGroupTabRowMatchesTheAgreedOrder(): void {
    self::assertCount(
      2,
      $this->tabOrder['Group detail'],
      'The sitemap file must parse exactly two Group detail tab rows.',
    );
    self::assertSame(
      $this->tabOrder['Group detail'],
      $this->tabRoutesOn('entity.bb_group.canonical', $this->accounts['lead']),
      'The group tab row is exactly Overview then Settings.',
    );
  }

  /**
   * The conductor tab row is Overview alone.
   */
  public function testConductorTabRowMatchesTheAgreedOrder(): void {
    self::assertCount(
      1,
      $this->tabOrder['Conductor detail'],
      'The sitemap file must parse exactly one Conductor detail tab row.',
    );
    self::assertSame(
      $this->tabOrder['Conductor detail'],
      $this->tabRoutesOn('entity.bb_conductor.canonical', $this->accounts['lead']),
      'The conductor tab row is exactly Overview.',
    );
  }

  /**
   * The machine tab row is View alone.
   */
  public function testMachineTabRowMatchesTheAgreedOrder(): void {
    self::assertCount(
      1,
      $this->tabOrder['Machine detail'],
      'The sitemap file must parse exactly one Machine detail tab row.',
    );
    self::assertSame(
      $this->tabOrder['Machine detail'],
      $this->tabRoutesOn('entity.bb_machine.canonical', $this->accounts['lead']),
      'The machine tab row is exactly View.',
    );
  }

  /**
   * OG's group-management route is gone from `bb_*` types, and only from those.
   *
   * THE DIRECT GUARD FOR `removeOgAdminRoutes()`, and it is written as a pair
   * on purpose. Asserting only that `entity.bb_project.og_admin_routes` does
   * not resolve would pass just as well on an installation where `og` never
   * built the route at all — a green test measuring an inactive module rather
   * than a removal. The second half fixes that: `entity.user.og_admin_routes`
   * MUST still resolve, because `og_entity_type_alter()` registers the link
   * template on every entity type and OG's `RouteSubscriber` builds one route
   * per template. So the pair says what the change actually claims — OG is
   * doing its usual work, and bakers.build's own types are taken out of it.
   *
   * The tab rows above are what this protects: `OgLocalTask` derives a tab from
   * each of these routes that exists, and with the route present those rows
   * carried a sixth and a seventh entry.
   */
  public function testOgAdminRoutesAreRemovedFromBbTypesOnly(): void {
    foreach (['bb_project', 'bb_team', 'bb_workspace'] as $entity_type_id) {
      $name = 'entity.' . $entity_type_id . '.og_admin_routes';
      self::assertSame(
        [],
        $this->routeNames($name),
        sprintf("OG's group-management route is back on %s.", $entity_type_id),
      );
    }

    self::assertSame(
      ['entity.user.og_admin_routes'],
      $this->routeNames('entity.user.og_admin_routes'),
      'OG builds no group-management route at all here, so the removals above '
      . 'prove nothing.',
    );
  }

  /**
   * The negative control: a guest is refused Runs but admitted to Stats.
   *
   * Without it, the order assertion above would also pass against a tab row
   * that always renders all six regardless of rank.
   */
  public function testGuestReachesStatsButNotRuns(): void {
    // Verified through a direct request rather than `plugin.manager.menu
    // .local_task` (as `testProjectTabRowMatchesTheAgreedOrder` uses):
    // `LocalTaskManager::getTasksBuild()` resolves each tab's access through
    // its own constructor-injected `$this->account`, and measured against
    // this account it does not track `actAs()`'s later `setAccount()` the way
    // a real request's own access checks do — confirmed by calling
    // `access_manager.checkNamedRoute()` directly with identical parameters,
    // which correctly denies. The tab link would still show for a guest, but
    // the route behind it is provably 403 either way (the main gate test
    // above), so this negative control asserts the guarantee that actually
    // holds: reachability, not link visibility.
    [$status] = $this->requestAs($this->pathFor('view.runs.project_runs'), $this->accounts['guest']);
    self::assertSame(403, $status, 'A guest must not reach view.runs.project_runs.');

    // STATS IS DELIBERATELY NOT IN THAT LIST ANY MORE. It used to be, on the
    // premise that a guest could read no figure and should therefore be offered
    // no tab. BB-462 removed the single `view bakers statistics` permission in
    // favour of one per figure, so the tab cannot gate on it without electing a
    // figure; it follows the entity instead and the figures filter themselves.
    // A guest reaches the tab and may find it empty, which is this scaffold's
    // normal state rather than a defect.
    [$status] = $this->requestAs($this->pathFor('bb_core.bb_project.stats'), $this->accounts['guest']);
    self::assertSame(200, $status, 'A guest reaches Stats; the figures gate themselves.');
  }

  /**
   * The workspace settings tab row is Settings, Members, Addons, Templates.
   */
  public function testWorkspaceSettingsTabRowMatchesTheAgreedOrder(): void {
    self::assertCount(
      4,
      $this->tabOrder['Workspace settings'],
      'The sitemap file must parse exactly four Workspace settings tab rows.',
    );
    self::assertSame(
      $this->tabOrder['Workspace settings'],
      $this->tabRoutesOn('bb_core.bb_workspace.settings', $this->accounts['lead']),
      'The workspace settings tab row is Settings, Members, Addons, Templates.',
    );
  }

  /**
   * The entity types with no sitemap place of their own.
   *
   * Their `/_workspace/` canonical route is deliberately excluded, matching
   * `tests/fixtures/web-ui-sitemap.md`'s own "Entity types with no nav home of
   * their own" section, which names this same set and states that it is the
   * complete one. Keep the two in step: the file is where a reader looks, and
   * a type excluded here but missing there is an exclusion nothing documents.
   *
   * - `bb_environment`, `bb_comment` — child records (project, ticket);
   *   the sitemap file states this explicitly.
   * - `bb_run` — an individual run's own page is not a nav place; the place
   *   is the Runs LISTING (`view.runs.*`), which the sitemap does declare.
   * - `bb_ticket` — "complete (deliberately no tab row)" per the umbrella's
   *   description; this ticket adds nothing to it and does not own it.
   *
   * @var array<string>
   */
  private const NO_NAV_HOME_ENTITY_TYPES = [
    'bb_environment', 'bb_comment', 'bb_run', 'bb_ticket',
    'bb_ticket_template',
  ];

  /**
   * Named routes with no nav home, excluded by name rather than entity type.
   *
   * `bb_core.run_log_download` is a run's OWN log-download action (BB-556
   * AC4/AC10), not that run's canonical page, so it needs a name here rather
   * than a place in `NO_NAV_HOME_ENTITY_TYPES`'s entity-type-keyed exclusion.
   * Matches `tests/fixtures/web-ui-sitemap.md`'s own bullet naming it for the
   * same reason — keep the two in step.
   *
   * @var array<string>
   */
  private const NO_NAV_HOME_ROUTES = [
    'bb_core.run_log_download',
    // Former Settings url: redirects to the detail page's cards.
    'bb_core.bb_team.settings',
    // Overlay body for the island dialog; the canonical run is already
    // excluded as a no-nav-home entity type.
    'entity.bb_run.overlay',
    // A review's state-widget endpoint, posted to from the ticket.
    'bb_core.review_transition',
    // A ticket template's own Create ticket confirmation.
    'bb_core.ticket_template_instantiate_form',
  ];

  /**
   * Every product route under `/_workspace/` is named in the sitemap file.
   *
   * The reverse half of the bidirectional check the file itself promises
   * (line 10: "a product route present in routing but absent from here fails
   * it too"). Enumerated from `router.route_provider`'s OWN route table
   * rather than a hard-coded snapshot of the routes this ticket happened to
   * add: a fourteenth route a follow-up adds under this same prefix, through
   * any of these mechanisms, fails this assertion the moment it exists,
   * whether or not it is named in this class.
   *
   * Two kinds of route are excluded, both DERIVED rather than named by route
   * name, so neither exclusion has to be kept in step with a growing route
   * list by hand:
   * - every entity CRUD route (`_entity_form` in its defaults — add/edit
   *   /delete/create/property forms), because a form is plumbing, never a
   *   nav place;
   * - the canonical route of an entity type in
   *   {@see self::NO_NAV_HOME_ENTITY_TYPES}, because the sitemap file itself
   *   documents those as having no nav home.
   */
  public function testEveryRouteThisTicketAddsIsInTheFile(): void {
    $provider = $this->container->get('router.route_provider');
    $known = array_keys($this->rows);
    $checked = 0;

    foreach ($provider->getAllRoutes() as $route_name => $route) {
      if (!str_starts_with($route->getPath(), '/_workspace/')) {
        continue;
      }
      if ($route->getDefault('_entity_form') !== NULL) {
        continue;
      }
      foreach (self::NO_NAV_HOME_ENTITY_TYPES as $entity_type_id) {
        if ($route_name === 'entity.' . $entity_type_id . '.canonical') {
          continue 2;
        }
      }
      if (in_array($route_name, self::NO_NAV_HOME_ROUTES, TRUE)) {
        continue;
      }
      $checked++;
      self::assertContains($route_name, $known, sprintf('%s (%s) must be a row in the sitemap file.', $route_name, $route->getPath()));
    }
    self::assertGreaterThan(0, $checked, 'This test must actually check at least one route, or it proves nothing.');

    // The forward half: every route the file names must resolve.
    foreach ($known as $route_name) {
      self::assertNotNull($provider->getRouteByName($route_name), sprintf('%s must resolve.', $route_name));
    }
  }

  /**
   * The route names that actually resolve, out of one requested name.
   *
   * Asked one name at a time through `getRouteByName()`, whose contract is a
   * route or a throw — `getRoutesByNames()` answers a shape the static analyser
   * cannot narrow, and a list of one is all this assertion needs. The empty
   * answer is what "removed" looks like.
   *
   * @param string $name
   *   The route name to look up.
   *
   * @return array<int, string>
   *   The names that resolved, which is either none or that one.
   */
  private function routeNames(string $name): array {
    try {
      $this->container->get('router.route_provider')->getRouteByName($name);
    }
    catch (RouteNotFoundException) {
      return [];
    }
    return [$name];
  }

  /**
   * Reads the sitemap file's tables into per-route rows and per-table order.
   *
   * @return array{0: array<string, array{place: string, table: string}>, 1: array<string, array<string>>}
   *   The rows keyed by route name, and the per-table ordered route lists.
   */
  private function parseSitemap(): array {
    $path = dirname(__DIR__, 2) . '/fixtures/web-ui-sitemap.md';
    self::assertFileExists($path, 'The sitemap file must be shipped.');
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    self::assertIsArray($lines);

    $rows = [];
    $order = [];
    $table = NULL;
    foreach ($lines as $line) {
      if (preg_match('/^## (.+)$/', $line, $heading)) {
        $table = trim($heading[1]);
        continue;
      }
      if ($table === NULL || !str_starts_with(trim($line), '|')) {
        continue;
      }
      $cells = array_map('trim', explode('|', trim($line, "| \t")));
      if (count($cells) < 6 || $cells[1] === 'Route name' || str_starts_with($cells[1], '---')) {
        continue;
      }
      $place = trim($cells[0], '* ');
      $route_cell = $cells[1];
      // The Rail's `Teams` row names a per-team pattern route rather than one
      // static route; it is documentation for a dynamic surface and carries
      // no single route this test can drive as a "place" of its own.
      if (str_contains($route_cell, '(one row per team)')) {
        continue;
      }
      $route_name = trim(explode(' ', str_replace('`', '', $route_cell))[0]);
      if ($route_name === '' || $route_name === '—') {
        continue;
      }
      $rows[$route_name] = ['place' => $place, 'table' => $table];
      $tab_tables = [
        'Project detail — eight tabs, Overview default' => 'Project detail',
        'Team detail — five tabs, Overview default' => 'Team detail',
        'Workspace settings — four tabs, Settings default' => 'Workspace settings',
        'Group detail — two tabs, Overview default' => 'Group detail',
        'Conductor detail — one tab, Overview default' => 'Conductor detail',
        'Machine detail — one tab, View default' => 'Machine detail',
      ];
      if (isset($tab_tables[$table])) {
        $order[$tab_tables[$table]][] = $route_name;
      }
    }
    self::assertNotSame([], $rows, 'The sitemap file must yield at least one row.');
    // Cardinality asserted HERE too, at parse time, not only where the parsed
    // order is later compared to the rendered tab row: this is the guard
    // against the `count($cells) < 6` skip above silently dropping a
    // malformed table row, which would otherwise shrink `$order` with nothing
    // downstream able to tell the difference from a genuinely six/five-row
    // table.
    self::assertCount(8, $order['Project detail'] ?? [], 'The sitemap file must declare exactly eight Project detail tabs.');
    self::assertCount(5, $order['Team detail'] ?? [], 'The sitemap file must declare exactly five Team detail tabs.');
    self::assertCount(4, $order['Workspace settings'] ?? [], 'The sitemap file must declare exactly four Workspace settings tabs.');
    self::assertCount(2, $order['Group detail'] ?? [], 'The sitemap file must declare exactly two Group detail tabs.');
    self::assertCount(1, $order['Conductor detail'] ?? [], 'The sitemap file must declare exactly one Conductor detail tab.');
    self::assertCount(1, $order['Machine detail'] ?? [], 'The sitemap file must declare exactly one Machine detail tab.');
    return [$rows, $order];
  }

  /**
   * The expected status per route for an account with NO membership at all.
   *
   * Kept beside EXPECTED_STATUS rather than folded into it, because the
   * question it answers is a different one: not "does this rank hold the
   * permission" but "can a stranger tell this place exists". 404 is the
   * answer that keeps a foreign workspace indistinguishable from a
   * nonexistent one — and it is the answer on only TWO of the fourteen places.
   *
   * THE SPLIT IS 12 / 2, AND IT IS A RECORDED OPEN QUESTION RATHER THAN A
   * BLESSED SHAPE. The rule the measurement produced is sharp: a place gated
   * on `_entity_access` answers **403** to a stranger, and a place gated on
   * `_permission` alone answers **404**. A stranger holds the permission
   * nowhere, so an `_entity_access` check denies FORBIDDEN and wins
   * `AccessResult::andIf()`, while `_permission` denies NEUTRAL and lets
   * `BbWorkspaceAccessCheck`'s marked forbidden survive to
   * `BbWorkspaceNotFoundSubscriber`, which turns it into 404. Only
   * `view.projects.workspace_list`, `view.groups.workspace_list` and
   * `view.tickets.my_work` are in the second group — they are the
   * workspace-level places with no entity in the path.
   *
   * So twelve of the fourteen places tell a stranger that the project, team
   * or workspace in the URL exists. That is the same class of leak round 4's
   * finding 3 named, and that finding is NOT regressed here: its fix restored
   * 404 for an account that HOLDS `view bb_project` in another workspace —
   * the case it was raised about, pinned by
   * `WorkspaceRouteAccessTest::testWrongWorkspaceIs404()`. A true non-member
   * is a different account meeting a different branch, and it was never
   * measured until this table forced it.
   *
   * It is stated rather than fixed because closing it is a change to how
   * every `/_workspace/` route folds its access results — BB-454 scaffolds
   * places, it does not own the access-result fold, and the same shape sits
   * on every entity edit/delete form this ticket never touched. What this
   * table buys is that the leak is now WRITTEN DOWN and watched: the
   * disjunction it replaced accepted 403 and 404 alike and could not tell the
   * twelve from the two, so nobody could have found this by reading it.
   *
   * @var array<string, int>
   */
  private const EXPECTED_STATUS_NON_MEMBER = [
    // Gated on `_permission` alone, no entity in the path — 404, no leak.
    'view.projects.workspace_list' => 404,
    'view.groups.workspace_list' => 404,
    'view.bb_ticket_templates.workspace_list' => 404,
    'view.tickets.my_work' => 404,
    // Authenticated, but with no membership the workspace prefix does not
    // resolve — the same 404 the sibling My work row gets, and for the same
    // reason: no entity in the path to admit the existence of.
    'bb_core.my_work.stats' => 404,
    // Gated on `_entity_access` — 403, and each one admits the entity exists.
    'bb_core.bb_workspace.settings' => 403,
    'bb_core.bb_workspace.members' => 403,
    'view.addons.settings' => 403,
    'bb_core.workspace_invite' => 403,
    'entity.bb_project.canonical' => 403,
    'view.project_board.project_board' => 403,
    'bb_core.bb_project.stats' => 403,
    'bb_core.bb_project.settings' => 403,
    'view.tickets.project_tickets' => 403,
    'view.runs.project_runs' => 403,
    'view.conductors.project_list' => 403,
    'view.bb_ticket_templates.project_list' => 403,
    'view.conductors.user_list' => 403,
    'view.machines.user_list' => 403,
    'entity.bb_team.canonical' => 403,
    'bb_core.bb_team.stats' => 403,
    'bb_core.bb_team.members' => 403,
    'view.tickets.team_tickets' => 403,
    'view.runs.team_runs' => 403,
    'entity.bb_group.canonical' => 403,
    'bb_core.bb_group.settings' => 403,
    'entity.bb_conductor.canonical' => 403,
    'entity.bb_machine.canonical' => 403,
    // Own-account View is 200; this request is the lead's uid, and no
    // bakers.build rank holds `access user profiles`, so a stranger is 403.
    'entity.user.canonical' => 403,
  ];

  /**
   * The hard-coded expected HTTP status per (route, rank) — BB-454 round 4.
   *
   * Deliberately NOT derived from the shipped `og.og_role.*` config any more.
   * The previous version resolved a permission name against
   * `shippedWorkspaceRolePermissions()`, which reads the SAME config the
   * production gate itself reads — a route dead for every rank (a typo'd
   * permission name, a route left off every role by mistake) would still
   * report a false PASS, because both sides of the comparison move together.
   * This table is the independent, literal answer instead: a status typed by
   * hand for each cell, so it can only agree with production by the gate
   * actually being correct.
   *
   * Reflects the shipped ranks as of BB-454 round 4: `contributor` no
   * longer carries `edit bb_project` / `delete bb_project` directly (moved
   * to `bb_team-bb_team-lead`, BB-454 round 4 review finding 1); the
   * project canonical route is gated on `bb_project.view`, not `.update`
   * (finding 3), so it is reachable by every ranked account here; and
   * `env_vars` carries no field-level gate of its own any more (finding 2),
   * which this route-level table does not otherwise touch.
   *
   * `non-member` has its own table, EXPECTED_STATUS_NON_MEMBER, because it
   * answers a different question — not "does this rank hold the permission"
   * but "can a stranger tell this place exists". Two blanket rules were
   * proposed for it and BOTH measured false: an earlier docblock claimed 403
   * throughout, and BB-454 round 4's review claimed 404 throughout. The
   * real answer is per route, and it is written out there.
   *
   * @var array<string, array<string, int>>
   */
  private const EXPECTED_STATUS = [
    'bb_core.bb_workspace.settings' => ['lead' => 200, 'contributor' => 403, 'guest' => 403],
    'bb_core.bb_workspace.members' => ['lead' => 200, 'contributor' => 403, 'guest' => 403],
    'view.addons.settings' => ['lead' => 200, 'contributor' => 403, 'guest' => 403],
    'bb_core.workspace_invite' => ['lead' => 200, 'contributor' => 403, 'guest' => 403],
    // Overview is a VIEW surface as of finding 3 (`bb_project.view`), so
    // every ranked account here — lead, contributor and guest all carry
    // `view bb_project` — reaches it.
    'entity.bb_project.canonical' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    // Settings is the remaining EDIT surface (`bb_project.update` /
    // `edit bb_project`), which round 4 finding 1 moved off `contributor`
    // and onto `bb_team-bb_team-lead` — the workspace `contributor` rank
    // no longer carries it, so only the workspace `lead` (which keeps its own
    // `edit bb_project`) reaches Settings here.
    'bb_core.bb_project.settings' => ['lead' => 200, 'contributor' => 403, 'guest' => 403],
    'bb_core.bb_project.stats' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    'bb_core.bb_team.stats' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    // My work > Stats gates on authentication alone (BB-481): a user's own
    // figures are always disclosed to them, so every rank with a membership
    // here reaches the page. What varies is which figures it renders, and
    // that is the disclosure service's answer rather than the route's.
    'bb_core.my_work.stats' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    // Guest carries no `view bb_run` in any shipped workspace rank.
    'view.runs.project_runs' => ['lead' => 200, 'contributor' => 200, 'guest' => 403],
    'view.runs.team_runs' => ['lead' => 200, 'contributor' => 200, 'guest' => 403],
    'entity.bb_team.canonical' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    'bb_core.bb_team.members' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    'view.project_board.project_board' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    'view.projects.workspace_list' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    'view.groups.workspace_list' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    // Every workspace rank carries `view bb_group`; only the lead carries
    // `update any bb_group`, so Settings is the lead's alone.
    'entity.bb_group.canonical' => ['lead' => 200, 'contributor' => 200, 'guest' => 200],
    'bb_core.bb_group.settings' => ['lead' => 200, 'contributor' => 403, 'guest' => 403],
    // Guest carries no `view bb_conductor` in any shipped workspace rank.
    'view.conductors.user_list' => ['lead' => 200, 'contributor' => 200, 'guest' => 403],
    'view.machines.user_list' => ['lead' => 200, 'contributor' => 200, 'guest' => 403],
    'view.conductors.project_list' => ['lead' => 200, 'contributor' => 200, 'guest' => 403],
    // No shipped guest rank carries `view bb_ticket_template`.
    'view.bb_ticket_templates.project_list' => ['lead' => 200, 'contributor' => 200, 'guest' => 403],
    'view.bb_ticket_templates.workspace_list' => ['lead' => 200, 'contributor' => 200, 'guest' => 403],
    'entity.bb_conductor.canonical' => ['lead' => 200, 'contributor' => 200, 'guest' => 403],
    'entity.bb_machine.canonical' => ['lead' => 200, 'contributor' => 403, 'guest' => 403],
    // The fixture path is the lead's account. Lead is viewing self (200);
    // other ranks have no `access user profiles` (403).
    'entity.user.canonical' => ['lead' => 200, 'contributor' => 403, 'guest' => 403],
  ];

  /**
   * The expected HTTP status for one route, for one rank.
   */
  private function expectedStatus(string $route_name, string $rank): int {
    // `non-member` never arrives here: the caller collects that rank into its
    // own map and `continue`s before calling this. The guard is therefore
    // unreachable today and exists only so that a future caller which forgets
    // to route the rank fails loudly instead of silently reading a ranked
    // expectation for a stranger. EXPECTED_STATUS_NON_MEMBER, not this table,
    // is where a non-member's status is stated — and it is NOT a single value.
    self::assertNotSame('non-member', $rank, 'the non-member rank is answered by the caller.');
    // THE TICKETS DISPLAYS CARRY NO PERMISSION GATE, deliberately, and this is
    // the one row of the matrix that does not reduce to a permission. They
    // declare `access: type: none` and delegate to the workspace-prefixed
    // route, so every rank with a membership in this workspace reaches them —
    // which is lead, contributor and guest alike. `non-member` is already
    // answered above. See `TicketsViewConfigTest` for what the delegation
    // rests on, and the sitemap file for why BB-454 added a `perm` gate here
    // and removed it again.
    if (str_starts_with($route_name, 'view.tickets.')) {
      return 200;
    }
    self::assertArrayHasKey(
      $route_name,
      self::EXPECTED_STATUS,
      sprintf('%s has no hard-coded expectation in this test.', $route_name),
    );
    self::assertArrayHasKey(
      $rank,
      self::EXPECTED_STATUS[$route_name],
      sprintf('%s has no hard-coded expectation for rank %s.', $route_name, $rank),
    );
    return self::EXPECTED_STATUS[$route_name][$rank];
  }

  /**
   * Runs a request through the real HTTP kernel, as the given account.
   *
   * @return array{0: int, 1: string}
   *   The response status code and rendered body.
   */
  private function requestAs(string $path, UserInterface $account): array {
    $this->actAs($account);
    $request = Request::create($path);
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return [$response->getStatusCode(), (string) $response->getContent()];
  }

  /**
   * Makes an account the current user for the requests that follow.
   */
  private function actAs(UserInterface $account): void {
    $this->container->get('current_user')->setAccount($account);
  }

  /**
   * The route names of the tab row rendered on one route, for one account.
   *
   * Mirrors `TeamTabLocalTasksTest::tabsOn()`/`enterRoute()`: stages a real
   * request carrying the ambient entities so `plugin.manager.menu.local_task`
   * has a route match to build tabs against, then reads the manager's task
   * list. That list is NOT access-filtered: `getLocalTasks()` puts the access
   * result on each task as `#access` and drops nothing, and it is the renderer
   * — via `LocalTasksBlock::build()` and `Element::getVisibleChildren()` — that
   * decides what `local_tasks_block` actually shows. Do not read this helper as
   * evidence about a tab's visibility for an account; assert on rendered HTML
   * for that.
   *
   * @return array<string>
   *   The tab route names the manager built, in its order.
   */
  private function tabRoutesOn(string $route_name, UserInterface $account): array {
    $this->actAs($account);
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $path = $this->pathFor($route_name);
    $request = Request::create($path);
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $raw = [];
    if (str_contains($route->getPath(), '{bb_workspace}')) {
      $request->attributes->set('bb_workspace', $this->workspace);
      $raw['bb_workspace'] = $this->workspace->getSlug();
    }
    if (str_contains($route->getPath(), '{bb_project}')) {
      $request->attributes->set('bb_project', $this->project);
      $raw['bb_project'] = (string) $this->project->id();
    }
    if (str_contains($route->getPath(), '{bb_team}')) {
      $request->attributes->set('bb_team', $this->team);
      $raw['bb_team'] = (string) $this->team->id();
    }
    if (str_contains($route->getPath(), '{bb_conductor}')) {
      $request->attributes->set('bb_conductor', $this->conductor);
      $raw['bb_conductor'] = (string) $this->conductor->id();
    }
    if (str_contains($route->getPath(), '{bb_machine}')) {
      $request->attributes->set('bb_machine', $this->machine);
      $raw['bb_machine'] = (string) $this->machine->id();
    }
    if (str_contains($route->getPath(), '{user}')) {
      $request->attributes->set('user', $this->accounts['lead']);
      $raw['user'] = (string) $this->accounts['lead']->id();
    }
    $request->attributes->set('_raw_variables', new ParameterBag($raw));
    $this->container->get('request_stack')->push($request);

    $manager = $this->container->get('plugin.manager.menu.local_task');
    $manager->clearCachedDefinitions();
    $tabs = [];
    // Sorted by weight as the renderer sorts them: tabs from several modules
    // (the Board tab is bb_board's) arrive in discovery order.
    $local = $manager->getLocalTasks($route_name, 0)['tabs'];
    uasort($local, static fn (array $a, array $b): int => ($a['#weight'] ?? 0) <=> ($b['#weight'] ?? 0));
    foreach ($local as $tab) {
      $tabs[] = $tab['#link']['url']->getRouteName();
    }
    $this->container->get('request_stack')->pop();
    return $tabs;
  }

  /**
   * Creates a user holding exactly the given permissions.
   */
  private function createAccount(string $name, array $permissions): UserInterface {
    $role_id = 'r_' . str_replace('-', '_', $name);
    $this->container->get('entity_type.manager')->getStorage('user_role')
      ->create(['id' => $role_id, 'label' => $role_id])->save();
    if ($permissions !== []) {
      user_role_grant_permissions($role_id, $permissions);
    }
    $user = $this->container->get('entity_type.manager')->getStorage('user')
      ->create(['name' => $name, 'status' => 1, 'roles' => [$role_id]]);
    self::assertInstanceOf(UserInterface::class, $user);
    $user->save();
    return $user;
  }

  /**
   * Creates and saves an entity of the given type.
   */
  private function create(string $entity_type_id, array $values): ContentEntityInterface {
    $entity = $this->container->get('entity_type.manager')
      ->getStorage($entity_type_id)
      ->create($values);
    self::assertInstanceOf(ContentEntityInterface::class, $entity);
    $entity->save();
    return $entity;
  }

  /**
   * The concrete PUBLIC path for a route, with the fixture entities filled in.
   *
   * A route's own path is the INTERNAL form (`/_workspace/{bb_workspace}/…`);
   * `BbWorkspacePathProcessor` adds that prefix on the way IN and strips it
   * on the way out, and `_workspace` itself fails the slug pattern — so
   * requesting the internal form directly 404s. The public form this test must
   * request is the same path with that one static segment dropped.
   */
  private function pathFor(string $route_name): string {
    $path = $this->container->get('router.route_provider')->getRouteByName($route_name)->getPath();
    $path = preg_replace('#^/_workspace#', '', $path, 1);
    return str_replace(
      [
        '{bb_workspace}',
        '{bb_project}',
        '{bb_team}',
        '{bb_group}',
        '{bb_conductor}',
        '{bb_machine}',
        '{user}',
      ],
      [
        $this->workspace->getSlug(),
        (string) $this->project->id(),
        (string) $this->team->id(),
        (string) $this->group->id(),
        (string) $this->conductor->id(),
        (string) $this->machine->id(),
        (string) $this->accounts['lead']->id(),
      ],
      $path,
    );
  }

  /**
   * The rendered page carries no visible PHP error or warning.
   */
  private function assertNoPhpErrorOrWarning(string $content, string $context): void {
    foreach (['Warning:', 'Notice:', 'Fatal error:', 'Deprecated:', 'Recoverable fatal error:'] as $needle) {
      self::assertStringNotContainsString($needle, $content, sprintf('%s must render with no PHP error or warning.', $context));
    }
  }

}
