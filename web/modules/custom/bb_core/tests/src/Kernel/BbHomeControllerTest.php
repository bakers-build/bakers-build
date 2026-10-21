<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Cache\CacheableResponseInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\file\Entity\File;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Controller\BbHomeController;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * The landing route answers with one workspace's My work, or with the chooser.
 *
 * BB-415 D4/D5. `/` is `system.site.front` and points at `/home`, so this
 * controller is the first thing a signed-in operator meets, and it has to give
 * three different answers to the same request depending on nothing but who is
 * asking. The three are asserted separately because they fail separately:
 *
 * - EXACTLY ONE candidate → 302 to `/{slug}/tickets`. The address names the
 *   workspace and is bookmarkable, which is the whole acceptance criterion; a
 *   render at `/home` would have satisfied "reaches My work" and failed "the
 *   address is not `/`".
 * - ZERO or SEVERAL → 200 and a chooser. Not a 404, not a redirect into a
 *   guess: a workspace outside the reader's scope answers 404 through
 *   `BbWorkspaceNotFoundSubscriber`, so a wrong guess is a *page not found*
 *   with nothing naming the cause.
 *
 * THE SEARCH STACK IS IN THE MODULE LIST FOR ONE REASON, and it is the same one
 * `BbRailMyWorkTest` records: the redirect target is `view.tickets.my_work`,
 * which exists only once `views.view.tickets` is installed, and that view will
 * not install until its own dependencies are met. A stub route with a
 * `{bb_workspace}` slot would be cheaper and would let the central claim of
 * this file — that the emitted address is the PUBLIC `/{slug}/tickets` — hold
 * against a route the product does not have.
 *
 * THE REDIRECT CARRIES THE SLUG, NOT THE ID. The route's converter is
 * `bb_core.paramconverter.workspace_slug`; an id reaches it as an unknown
 * slug, fails to upcast, and the operator lands on a 404 with a URL that looks
 * right. `testTheRedirectNamesTheSlugAndNotTheId()` is that regression.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class BbHomeControllerTest extends KernelTestBase {

  use UserCreationTrait;
  use ProjectsViewTestTrait;
  use OgScopeFixtureTrait;
  use ShippedImageConfigTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image', 'crop',
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'bb_core',
    // The redirect target is the tickets view's `my_work` page display, so the
    // view has to install, and it will not install until every module it names
    // in `dependencies.module` is enabled.
    'views', 'search_api', 'search_api_db',
    'better_exposed_filters', 'facets', 'facets_exposed_filters',
    'views_filters_summary',
    'display_builder', 'ui_patterns_views', 'display_builder_views',
  ];

  /**
   * The account under test — a plain reader with no bypass.
   */
  private UserInterface $operator;

  /**
   * {@inheritdoc}
   */
  protected function setUpFilesystem(): void {
    parent::setUpFilesystem();
    // Before the container is built, so the private stream wrapper exists.
    $this->setSetting('file_private_path', $this->siteDirectory . '/private');
  }

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    // `bb_invite` joined the list with BB-430: the controller now asks the
    // invite matcher which workspaces are joinable, and that query needs the
    // table even when no invitation exists.
    // `bb_team` joined the list because
    // `testBothAnswersDeclareTheirCacheability()` now performs entity
    // operations while the acting session already carries workspace
    // memberships, which is enough to make `BbWorkspaceReadScope`'s
    // query-access check query the table.
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_invite', 'bb_ticket', 'search_api_task'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'search_api']);
    $this->installEntitySchema('file');
    $this->installSchema('file', ['file_usage']);
    $this->installEntitySchema('crop');
    $this->installAvatarStyle();
    $this->installOgScopeFixture();
    // The chooser and the empty state are SDC components of the front-end
    // theme, and R4 says every assertion about the chooser's payload is made
    // against the rendered output — so the theme that owns those components has
    // to be installed and default, or the render is a LoaderError rather than
    // an answer.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    // The view is what registers `view.tickets.my_work`.
    $this->container->get('config.installer')
      ->installOptionalConfig(NULL, ['module' => 'bb_core']);
    // The tickets view left config/optional for its two homes on BB-315, so
    // the optional sweep above no longer creates it — install the recipe copy.
    $this->installShippedView('views.view.tickets');
    $this->container->get('router.builder')->rebuild();

    // Uid 1 bypasses every access check, so it must never be an actor here.
    $this->createUser([], 'uid1-dummy');
    // The account every workspace below is owned by. OG makes an owner a member
    // on save, so an actor that owned a workspace would hold a membership
    // nobody wrote and the negative cases would be testing the fixture.
    $this->createUser([], 'world-owner');
    $operator = $this->createUser(['view bb_workspace'], 'operator');
    self::assertInstanceOf(UserInterface::class, $operator);
    $this->operator = $operator;
  }

  /**
   * One membership redirects into that workspace's My work list.
   */
  public function testOneWorkspaceRedirectsToItsMyWorkList(): void {
    $workspace = $this->workspace('bakers');
    $this->addMembership($workspace, $this->operator);

    $response = $this->landAs($this->operator);

    self::assertInstanceOf(RedirectResponse::class, $response);
    self::assertSame(302, $response->getStatusCode());
    self::assertSame(
      '/bakers/tickets',
      $response->getTargetUrl(),
      'The address must name the workspace and be bookmarkable.',
    );
  }

  /**
   * The landing route renders the overview even with one workspace held.
   *
   * THE COUNTERPART TO THE 302 ABOVE, and the reason BB-430 r5 exists: under
   * the old rule an operator with exactly one workspace was thrown into it on
   * every visit, so the overview was a page that existed and could not be
   * opened. `/` still means "take me to my work"; `/home` means "show me my
   * workspaces", and the two are one route answering the question it was asked.
   */
  public function testTheLandingRouteRendersTheOverviewForOneWorkspace(): void {
    $workspace = $this->workspace('bakers');
    $this->addMembership($workspace, $this->operator);

    $build = $this->landAs($this->operator, '/home');

    self::assertIsArray($build, 'The landing route renders rather than redirecting.');
    self::assertSame(
      'chooser',
      $this->bodyKind($build),
      'One workspace on /home is the overview, not a redirect.',
    );
    self::assertSame(['bakers'], $this->candidateSlugs($build));
    // Rendered, for the same reason the chooser test states: a green build
    // array says nothing about what reaches the page.
    $html = (string) $this->container->get('renderer')->renderRoot($build);
    self::assertStringContainsString('/bakers/tickets', $html);
  }

  /**
   * The redirect names a NON-default workspace when that is the one held.
   *
   * Acceptance criterion 4. Without this the single-workspace case above would
   * pass against a controller that hard-codes `bakers`, which is exactly the
   * status quo this ticket replaces.
   */
  public function testMemberOfAnotherWorkspaceLandsInThatWorkspace(): void {
    $this->workspace('bakers');
    $this->addMembership($this->workspace('other'), $this->operator);

    $response = $this->landAs($this->operator);

    self::assertInstanceOf(RedirectResponse::class, $response);
    self::assertSame('/other/tickets', $response->getTargetUrl());
  }

  /**
   * The redirect carries the SLUG, so the route's converter can upcast it.
   */
  public function testTheRedirectNamesTheSlugAndNotTheId(): void {
    $workspace = $this->workspace('acme');
    $this->addMembership($workspace, $this->operator);

    $response = $this->landAs($this->operator);

    self::assertInstanceOf(RedirectResponse::class, $response);
    self::assertStringNotContainsString(
      '/' . $workspace->id() . '/',
      $response->getTargetUrl(),
      'An id reaches the slug converter as an unknown slug and 404s.',
    );
  }

  /**
   * Two memberships render the chooser, carrying both workspaces.
   */
  public function testTwoWorkspacesRenderTheChooser(): void {
    $this->addMembership($this->workspace('bakers'), $this->operator);
    $this->addMembership($this->workspace('other'), $this->operator);

    $build = $this->landAs($this->operator);

    self::assertIsArray($build);
    $slugs = $this->candidateSlugs($build);
    self::assertSame(['bakers', 'other'], $slugs);
    // Asserted on the RENDERED output, never on the build alone:
    // display_builder drops an invalid SDC prop silently, and
    // ui_patterns' CompatibilityChecker
    // mistypes array props, so a green render array proves nothing about what
    // reaches the page.
    $html = (string) $this->container->get('renderer')->renderRoot($build);
    self::assertStringContainsString('/bakers/tickets', $html);
    self::assertStringContainsString('/other/tickets', $html);
    // The body marker sits on the zone's root, and the create action is the
    // cell after the chooser, so the zone's gap stands between them.
    self::assertMatchesRegularExpression('/<section[^>]*data-bakers-home-body="chooser"/', $html);
    self::assertSame(1, substr_count($html, '/home/new-workspace'));
    self::assertLessThan(strpos($html, '/home/new-workspace'), strpos($html, '/other/tickets'));
  }

  /**
   * Each chooser row leads with the workspace's mark and adds its description.
   */
  public function testChooserRowsCarryMarkAndDescription(): void {
    $bakers = $this->workspace('bakers');
    $bakers->set('description', "Where the platform is built.\nBy <b>us</b>.")->save();
    $this->addMembership($bakers, $this->operator);
    $this->addMembership($this->workspace('other'), $this->operator);

    $build = $this->landAs($this->operator);
    self::assertIsArray($build);
    $items = $build['#slots']['content']['chooser']['#props']['items'];
    $rows = array_column(array_map(static fn (array $item): array => [$item['cells']['slug']['value'], $item['cells']], $items), 1, 0);
    self::assertSame('person', $rows['bakers']['mark']['kind']);
    self::assertSame('', $rows['bakers']['mark']['picture'], 'No image: initials.');
    self::assertSame("Where the platform is built.\nBy <b>us</b>.", $rows['bakers']['description']['value']);
    self::assertArrayNotHasKey('description', $rows['other'], 'No description: no cell.');
    self::assertSame(['mark', 'workspace', 'slug', 'description'], array_keys($rows['bakers']));

    $html = (string) $this->container->get('renderer')->renderRoot($build);
    // Escaped, and its line break kept and shown as one.
    self::assertStringContainsString("Where the platform is built.\nBy &lt;b&gt;us&lt;/b&gt;.", $html);
    self::assertMatchesRegularExpression('/<span class="[^"]*whitespace-pre-line[^"]*">Where the platform/', $html);
    self::assertSame(2, substr_count($html, 'data-person-mark'));
  }

  /**
   * A member's chooser row shows the workspace's cropped image.
   */
  public function testChooserRowShowsTheCroppedImage(): void {
    $bakers = $this->workspace('bakers');
    $directory = 'private://workspace-images';
    $this->container->get('file_system')->prepareDirectory($directory, 1);
    file_put_contents($directory . '/bakers.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
    $file = File::create(['uri' => $directory . '/bakers.png', 'status' => 1]);
    $file->save();
    $bakers->set('image', $file->id())->save();
    $this->addMembership($bakers, $this->operator);
    $this->addMembership($this->workspace('other'), $this->operator);

    $build = $this->landAs($this->operator);
    self::assertIsArray($build);
    $items = $build['#slots']['content']['chooser']['#props']['items'];
    $rows = array_column(array_map(static fn (array $item): array => [$item['cells']['slug']['value'], $item['cells']], $items), 1, 0);
    self::assertStringContainsString('/system/files/styles/avatar/private/workspace-images/bakers.png', $rows['bakers']['mark']['picture']);
    self::assertSame('', $rows['other']['mark']['picture'], 'No image: initials.');
  }

  /**
   * No membership renders the overview empty state, not a redirect.
   */
  public function testNoWorkspaceRendersEmptyOverview(): void {
    $this->workspace('bakers');

    $build = $this->landAs($this->operator);

    self::assertIsArray($build);
    self::assertSame(
      'empty',
      $this->bodyKind($build),
    );
  }

  /**
   * Setup guide stays on Home even when the account holds no workspace.
   */
  public function testSetupGuideIsReachableWithZeroMemberships(): void {
    $this->workspace('bakers');

    $build = $this->landAs($this->operator, '/home');

    self::assertIsArray($build);
    self::assertSame('empty', $this->bodyKind($build));
    $guide = $build['#slots']['content']['setup_guide'] ?? [];
    self::assertSame('bb_theme:button', $guide['#component'] ?? NULL);
    self::assertSame('Setup guide', (string) ($guide['#props']['label'] ?? ''));
    self::assertSame('/home/onboarding', $guide['#props']['href'] ?? NULL);
  }

  /**
   * A bypass account's candidates are every workspace, membership or not.
   *
   * F5: `bb_core_install()` creates the default workspace with no
   * `og_membership` at all, so the administrator — the one account every
   * install path guarantees — has an empty membership set. A controller that
   * consulted memberships alone would send that account to the no-workspace
   * answer on a freshly installed site.
   */
  public function testBypassAccountSeesEveryWorkspace(): void {
    $this->workspace('bakers');
    $this->workspace('other');
    $admin = $this->createUser(['administer bakers'], 'bakers-admin');
    self::assertInstanceOf(UserInterface::class, $admin);

    $build = $this->landAs($admin);

    self::assertIsArray($build);
    self::assertSame(['bakers', 'other'], $this->candidateSlugs($build));
  }

  /**
   * Candidates are ordered by slug ascending, not by creation order.
   */
  public function testCandidatesAreOrderedBySlugAscending(): void {
    foreach (['zulu', 'alpha', 'mike'] as $slug) {
      $this->addMembership($this->workspace($slug), $this->operator);
    }

    $build = $this->landAs($this->operator);

    self::assertIsArray($build);
    self::assertSame(['alpha', 'mike', 'zulu'], $this->candidateSlugs($build));
  }

  /**
   * Both answers declare the three dependencies the question is derived from.
   *
   * The same `user` context and the same two list tags
   * `BbWorkspaceAccessCheck` declares for the same question. Without them a
   * new membership leaves the operator staring at the previous answer.
   */
  public function testBothAnswersDeclareTheirCacheability(): void {
    $this->workspace('bakers');
    $this->workspace('other');
    // Created up front, before any `landAs()` call sets the acting session to
    // `$this->operator` — a query access check run as that operator once
    // memberships exist needs `bb_team`, which nothing else in this test
    // installs a schema for.
    $solo = $this->createUser(['view bb_workspace'], 'solo-operator');
    self::assertInstanceOf(UserInterface::class, $solo);

    // No membership in either workspace: the empty overview renders.
    $noCandidates = $this->landAs($this->operator);
    self::assertIsArray($noCandidates);
    self::assertContains('user', $noCandidates['#cache']['contexts']);
    self::assertContains('og_membership_list', $noCandidates['#cache']['tags']);
    self::assertContains('bb_workspace_list', $noCandidates['#cache']['tags']);

    // Two memberships: the chooser renders, even on `/` (only exactly one
    // candidate redirects there).
    $this->addMembership($this->workspace('bakers'), $this->operator);
    $this->addMembership($this->workspace('other'), $this->operator);
    $chooser = $this->landAs($this->operator);
    self::assertIsArray($chooser);
    self::assertContains('user', $chooser['#cache']['contexts']);
    self::assertContains('og_membership_list', $chooser['#cache']['tags']);
    self::assertContains('bb_workspace_list', $chooser['#cache']['tags']);

    // One workspace only, another operator: the single-membership redirect.
    $this->addMembership($this->workspace('bakers'), $solo);
    $redirect = $this->landAs($solo);
    self::assertInstanceOf(CacheableResponseInterface::class, $redirect);
    $metadata = $redirect->getCacheableMetadata();
    self::assertContains('user', $metadata->getCacheContexts());
    self::assertContains('og_membership_list', $metadata->getCacheTags());
    self::assertContains('bb_workspace_list', $metadata->getCacheTags());
  }

  /**
   * Creates — or returns — the workspace with the given slug.
   *
   * @param string $slug
   *   The slug, which is also the name.
   *
   * @return \Drupal\bb_core\Entity\BbWorkspaceInterface
   *   The saved workspace.
   */
  private function workspace(string $slug): BbWorkspaceInterface {
    $storage = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace');
    $existing = $storage->loadByProperties(['slug' => $slug]);
    if ($existing !== []) {
      $workspace = reset($existing);
      self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
      return $workspace;
    }
    $owner = user_load_by_name('world-owner');
    self::assertInstanceOf(UserInterface::class, $owner);
    $workspace = $storage->create([
      'name' => $slug,
      'slug' => $slug,
      'owner_user_id' => $owner->id(),
    ]);
    $workspace->save();
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    return $workspace;
  }

  /**
   * Runs the controller as the given account.
   *
   * @param \Drupal\user\UserInterface $account
   *   The operator.
   * @param string $path
   *   The address the request came in on — `/` for the site root, `/home` for
   *   the landing route. The two resolve to one route and get different
   *   answers from it (BB-430 r5).
   *
   * @return array<string, mixed>|\Symfony\Component\HttpFoundation\Response
   *   Whatever the controller answered.
   */
  private function landAs(UserInterface $account, string $path = '/') {
    $this->setCurrentUser($account);
    $this->container->get('bb_core.workspace_read_scope')->reset();
    // THE PATH DECIDES ONE OF THE ANSWERS, so it is a parameter rather than an
    // ambient default: `/` and `/home` resolve to the same route and ask
    // different questions of it (BB-430 r5).
    $stack = $this->container->get('request_stack');
    $stack->push(Request::create($path));
    try {
      return BbHomeController::create($this->container)->land();
    }
    finally {
      $stack->pop();
    }
  }

  /**
   * Reads which overview body a build carries off its root attributes.
   *
   * @param array<string, mixed> $build
   *   The render array the controller returned.
   *
   * @return string|null
   *   `chooser`, `joinable`, `empty`, or NULL when the marker is absent.
   */
  private function bodyKind(array $build): ?string {
    $attributes = $build['#props']['attributes'] ?? NULL;
    return isset($attributes[BbHomeController::BODY_ATTRIBUTE])
      ? (string) $attributes[BbHomeController::BODY_ATTRIBUTE]
      : NULL;
  }

  /**
   * Reads the candidate slugs out of a chooser build.
   *
   * Derived from the ITEM TARGETS the build actually carries rather than from a
   * key the controller exposes for this test: a test-only property on a
   * production render array would pass while the thing the operator clicks
   * pointed somewhere else.
   *
   * @param array<string, mixed> $build
   *   The render array the controller returned.
   *
   * @return array<string>
   *   The slugs, in the order the build carries them.
   */
  private function candidateSlugs(array $build): array {
    $items = $build['#slots']['content']['chooser']['#props']['items'] ?? [];
    $slugs = [];
    foreach ($items as $item) {
      $slugs[] = explode('/', ltrim((string) ($item['url'] ?? ''), '/'))[0];
    }
    return $slugs;
  }

}
