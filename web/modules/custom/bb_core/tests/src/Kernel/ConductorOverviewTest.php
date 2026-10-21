<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Plugin\UiPatterns\Source\ConductorOccupancySource;
use Drupal\bb_core\Routing\BbConductorRouteProvider;
use Drupal\ui_patterns\SourcePluginBase;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Conductor listings, canonical route, and occupancy Overview.
 *
 * BB-619. Two collections: the user-area rail item Conductors is
 * the URL account's conductors; the project tab is that project's
 * conductors. The detail is
 * core's `_entity_view` of `bb_conductor.full`. Live occupancy is the
 * `bb_conductor_occupancy` source plus the `conductor_tickets` embed.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConductorOverviewTest extends KernelTestBase {

  use ShippedDisplayTrait;

  use OgScopeFixtureTrait;
  use ProjectsViewTestTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'island', 'link', 'text', 'filter', 'markdown_easy', 'views',
    'better_exposed_filters', 'ui_patterns', 'ui_patterns_views',
    'ui_patterns_field', 'ui_patterns_field_formatters',
    'display_builder', 'display_builder_views', 'display_builder_entity_view',
    'bb_core',
  ];

  /**
   * The workspace the fixtures live in.
   */
  private ContentEntityInterface $home;

  /**
   * A second workspace used for the cross-workspace assertions.
   */
  private ContentEntityInterface $other;

  /**
   * A labelled conductor in the home workspace.
   */
  private BbConductorInterface $labelled;

  /**
   * A blank-label conductor in the home workspace.
   */
  private BbConductorInterface $blank;

  /**
   * A conductor in the other workspace.
   */
  private BbConductorInterface $foreign;

  /**
   * A conductor with no project (empty fence hop, workspace mismatch 404).
   */
  private BbConductorInterface $orphan;

  /**
   * The project the home-workspace conductors belong to.
   */
  private ContentEntityInterface $homeProject;

  /**
   * A second project in the home workspace, for project-tab isolation.
   */
  private ContentEntityInterface $extraProject;

  /**
   * The project the foreign conductor belongs to.
   */
  private ContentEntityInterface $otherProject;

  /**
   * A home-workspace conductor owned by the contributor.
   */
  private BbConductorInterface $colleague;

  /**
   * A lead-owned conductor on the extra home-workspace project.
   */
  private BbConductorInterface $extra;

  /**
   * Ranked accounts in the home workspace.
   *
   * @var array<string, \Drupal\user\UserInterface>
   */
  private array $accounts = [];

  /**
   * Frozen request time for occupancy lease comparisons.
   */
  private const FROZEN_NOW = 2000000000;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_machine', 'bb_conductor', 'bb_ticket', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'views']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->installOgScopeFixture();
    // User 1 bypasses every access check; consume that uid so the accounts
    // below are ordinary users whose verdicts this test can actually measure.
    $this->createAccount('root', []);

    $this->home = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);
    $this->other = $this->create('bb_workspace', ['name' => 'Other', 'slug' => 'other']);
    $home_group = $this->create('bb_group', [
      'name' => 'bakers.build group',
      'workspace_id' => $this->home->id(),
    ]);
    $this->homeProject = $this->create('bb_project', [
      'name' => 'bakers.build',
      'key' => 'bakers.build',
      'group_id' => $home_group->id(),
    ]);
    $this->extraProject = $this->create('bb_project', [
      'name' => 'Extra',
      'key' => 'XTRA',
      'group_id' => $home_group->id(),
    ]);
    $other_group = $this->create('bb_group', [
      'name' => 'Other group',
      'workspace_id' => $this->other->id(),
    ]);
    $this->otherProject = $this->create('bb_project', [
      'name' => 'Other',
      'key' => 'OTHR',
      'group_id' => $other_group->id(),
    ]);

    foreach (['lead', 'contributor', 'guest'] as $rank) {
      $account = $this->createAccount($rank, []);
      $this->addMembership($this->home, $account, [$rank]);
      $this->accounts[$rank] = $account;
    }
    $this->addMembership($this->other, $this->accounts['lead'], ['lead']);

    $host = $this->create('bb_machine', [
      'name' => 'Host',
      'host_key' => 'host-alpha',
      'owner_user_id' => $this->accounts['lead']->id(),
      'max_parallel' => 4,
    ]);
    $labelled = $this->create('bb_conductor', [
      'conductor_id' => 'reg-alpha',
      'label' => 'Alpha',
      'project_id' => $this->homeProject->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
      'status' => 'online',
      'reported_load' => 2,
      'machine' => $host->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $labelled);
    $this->labelled = $labelled;

    $blank = $this->create('bb_conductor', [
      'conductor_id' => 'reg-blank',
      'label' => '',
      'project_id' => $this->homeProject->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
      'status' => 'offline',
      'reported_load' => 0,
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $blank);
    $this->blank = $blank;

    $colleague = $this->create('bb_conductor', [
      'conductor_id' => 'reg-colleague',
      'label' => 'Colleague',
      'project_id' => $this->homeProject->id(),
      'owner_user_id' => $this->accounts['contributor']->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $colleague);
    $this->colleague = $colleague;

    $extra = $this->create('bb_conductor', [
      'conductor_id' => 'reg-extra',
      'label' => 'Extra',
      'project_id' => $this->extraProject->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $extra);
    $this->extra = $extra;

    $foreign = $this->create('bb_conductor', [
      'conductor_id' => 'reg-foreign',
      'label' => 'Foreign',
      'project_id' => $this->otherProject->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $foreign);
    $this->foreign = $foreign;

    $orphan = $this->create('bb_conductor', [
      'conductor_id' => 'reg-orphan',
      'label' => 'Orphan',
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $orphan);
    $this->orphan = $orphan;

    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The canonical route is the product Overview, not a controller.
   */
  public function testCanonicalRouteRendersAndNamesTheConductor(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_conductor.canonical');

    self::assertSame('/_workspace/{bb_workspace}/conductor/{bb_conductor}', $route->getPath());
    self::assertSame('bb_conductor.full', $route->getDefault('_entity_view'));
    self::assertSame('bb_conductor.view', $route->getRequirement('_entity_access'));
    self::assertNull($route->getDefault('_controller'));
    self::assertSame(
      BbConductorRouteProvider::class . '::title',
      $route->getDefault('_title_callback'),
      "Core's EntityController::title would resolve the workspace, not the conductor.",
    );
    self::assertTrue(class_exists(BbConductorRouteProvider::class));
    self::assertSame('Alpha', BbConductorRouteProvider::title($this->labelled));
    self::assertSame('reg-blank', BbConductorRouteProvider::title($this->blank));
  }

  /**
   * Overview is the only product tab; admin collection stays put.
   */
  public function testOverviewIsTheOnlyProductTabAndAdminCollectionStays(): void {
    $collection = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_conductor.collection');
    self::assertSame('/admin/bakers/conductors', $collection->getPath());

    self::assertSame(
      ['entity.bb_conductor.canonical'],
      $this->tabRoutesOn('entity.bb_conductor.canonical', $this->accounts['lead']),
      'The product canonical carries Overview alone — no Settings tab.',
    );
  }

  /**
   * The cards and the confirmation share the detail's boundaries.
   */
  public function testCardAndActionRoutesShareTheDetailBoundaries(): void {
    $provider = $this->container->get('router.route_provider');
    foreach ([
      'entity.bb_conductor.identity_form' => ['/card/identity', 'bb_conductor.identity'],
      'entity.bb_conductor.action_form' => ['/action', 'bb_conductor.action'],
    ] as $name => [$suffix, $form]) {
      $route = $provider->getRouteByName($name);
      self::assertSame('/_workspace/{bb_workspace}/conductor/{bb_conductor}' . $suffix, $route->getPath());
      self::assertSame($form, $route->getDefault('_entity_form'));
      self::assertSame('bb_conductor.update', $route->getRequirement('_entity_access'));
      self::assertSame('TRUE', $route->getRequirement('_bb_workspace_match'));
      self::assertFalse($route->getOption('_admin_route'));
    }
    // The served states are not edited on a card (administrative form or API).
    self::assertSame([], $provider->getRoutesByNames(['entity.bb_conductor.configuration_form']));
    // The administrative edit form stays where it was.
    self::assertSame('/admin/bakers/conductor/{bb_conductor}/edit', $provider->getRouteByName('entity.bb_conductor.edit_form')->getPath());
  }

  /**
   * The owner edits and may disable; a peer only reads, and is refused.
   */
  public function testOwnerEditsAndPeerOnlyReadsTheCards(): void {
    $owner = $this->createAccount('owner', ['register bakers conductor']);
    $this->addMembership($this->home, $owner, ['contributor']);
    $mine = $this->create('bb_conductor', [
      'conductor_id' => 'reg-mine',
      'label' => 'Mine',
      'project_id' => $this->homeProject->id(),
      'owner_user_id' => $owner->id(),
      'status' => 'online',
      'states' => ['coding', 'review'],
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $mine);
    $base = '/bakers/conductor/' . $mine->id();

    $this->actAs($owner);
    self::assertSame(200, $this->statusOf($base . '/card/identity'));
    self::assertSame(200, $this->statusOf($base . '/action'));
    self::assertSame(404, $this->statusOf('/other/conductor/' . $mine->id() . '/card/identity'));
    $form = $this->container->get('entity.form_builder')->getForm($mine, 'identity');
    self::assertArrayHasKey('label', $form);
    self::assertSame('Save', (string) $form['actions']['submit']['#value']);
    self::assertArrayNotHasKey('states', $form, 'No card edits the served states.');
    self::assertArrayNotHasKey('active', $form, 'Activity changes only through the confirmation.');
    self::assertNull($this->container->get('entity_type.manager')->getDefinition('bb_conductor')->getFormClass('configuration'));
    self::assertSame('Disable conductor', $this->actionsSource($mine)['activity']['#props']['label'] ?? NULL);
    // The owner's confirm writes, although the stored project is a reference
    // this account could not select in a form.
    $action = $this->container->get('entity_type.manager')->getFormObject('bb_conductor', 'action');
    $action->setEntity($mine);
    $posted = (new FormState())->setRequestMethod('POST')
      ->setValues(['bb_confirm' => 'Disable conductor', 'bb_from_active' => '1']);
    $this->container->get('form_builder')->submitForm($action, $posted);
    $stored = $this->container->get('entity_type.manager')->getStorage('bb_conductor')->loadUnchanged($mine->id());
    self::assertInstanceOf(BbConductorInterface::class, $stored);
    self::assertFalse((bool) $stored->get('active')->value);

    $this->actAs($this->accounts['contributor']);
    self::assertSame(403, $this->statusOf($base . '/card/identity'));
    self::assertSame(403, $this->statusOf($base . '/action'));
    $form = $this->container->get('entity.form_builder')->getForm($stored, 'identity');
    self::assertArrayNotHasKey('label', $form);
    self::assertEmpty($form['actions'] ?? []);
    $rows = (string) $this->container->get('renderer')->renderInIsolation($form['readonly']);
    self::assertStringContainsString('Mine', $rows);
    self::assertStringNotContainsString('coding, review', $rows, 'The served states are not shown.');
    self::assertSame([], array_filter($this->actionsSource($stored), static fn(string $key): bool => $key[0] !== '#', ARRAY_FILTER_USE_KEY));
  }

  /**
   * The user listing is the URL account's conductors, any workspace.
   */
  public function testUserListingIsThisAccountsConductors(): void {
    $this->installShippedView('views.view.conductors');
    $this->container->get('account_switcher')->switchTo($this->accounts['lead']);

    $lead_ids = $this->viewResultIds(
      'conductors',
      [(string) $this->accounts['lead']->id()],
      'user_list',
    );
    self::assertEqualsCanonicalizing(
      [
        (string) $this->labelled->id(),
        (string) $this->blank->id(),
        (string) $this->extra->id(),
        (string) $this->foreign->id(),
      ],
      $lead_ids,
    );
    self::assertNotContains((string) $this->colleague->id(), $lead_ids);
    self::assertNotContains((string) $this->orphan->id(), $lead_ids);

    $this->container->get('account_switcher')->switchTo($this->accounts['contributor']);
    self::assertSame(
      [(string) $this->colleague->id()],
      $this->viewResultIds(
        'conductors',
        [(string) $this->accounts['contributor']->id()],
        'user_list',
      ),
    );
  }

  /**
   * A row puts load on the right, owner and last run below, status as a badge.
   */
  public function testRowPutsCapacityOnTheRight(): void {
    $this->freezeTime();
    $this->labelled->set('last_seen', self::FROZEN_NOW - 86400)->save();
    $this->installShippedView('views.view.conductors');
    $this->container->get('account_switcher')->switchTo($this->accounts['lead']);

    $view = Views::getView('conductors');
    $view->setDisplay('user_list');
    $view->setArguments([(string) $this->accounts['lead']->id()]);
    $view->preExecute();
    $view->execute();
    $build = $view->style_plugin->render();
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    $item = $this->itemNamed($html, 'Alpha');

    self::assertSame(['reported_load'], $this->cellIds($item, 'right'));
    self::assertSame(['2 loads'], $this->badgeTitles($item));
    $meta = $this->region($item, 'meta');
    self::assertStringContainsString('Online', $meta);
    self::assertStringContainsString('data-component-id="bb_theme:badge"', $meta);
    self::assertStringContainsString('bg-state-running-tint', $meta);
    $right_meta = $this->region($item, 'right_meta');
    self::assertStringContainsString('Owner', $right_meta);
    self::assertStringContainsString('lead', $right_meta);
    self::assertStringContainsString('Last run', $right_meta);
    self::assertMatchesRegularExpression('/\\d+ \\w+ ago/', $right_meta);
  }

  /**
   * The project tab lists that project's conductors regardless of owner.
   */
  public function testProjectListingIsTheProjectsConductors(): void {
    $this->installShippedView('views.view.conductors');
    $this->container->get('account_switcher')->switchTo($this->accounts['lead']);

    $home_ids = $this->viewResultIds(
      'conductors',
      [$this->homeSlug(), (string) $this->homeProject->id()],
      'project_list',
    );
    $extra_ids = $this->viewResultIds(
      'conductors',
      [$this->homeSlug(), (string) $this->extraProject->id()],
      'project_list',
    );

    self::assertEqualsCanonicalizing(
      [
        (string) $this->labelled->id(),
        (string) $this->blank->id(),
        (string) $this->colleague->id(),
      ],
      $home_ids,
    );
    self::assertSame([(string) $this->extra->id()], $extra_ids);
    self::assertNotContains((string) $this->foreign->id(), $home_ids);
    self::assertNotContains((string) $this->orphan->id(), $home_ids);
  }

  /**
   * The project canonical carries a Conductors tab on the project-list display.
   */
  public function testProjectHasConductorsTab(): void {
    $this->installShippedView('views.view.conductors');
    $this->container->get('router.builder')->rebuild();

    $route = $this->container->get('router.route_provider')
      ->getRouteByName('view.conductors.project_list');
    self::assertSame(
      '/_workspace/{bb_workspace}/project/{bb_project}/conductors',
      $route->getPath(),
    );
  }

  /**
   * The user-list display lives at `/user/{user}/conductors`, not as a tab.
   */
  public function testUserListIsNotLocalTask(): void {
    $this->installShippedView('views.view.conductors');
    $this->container->get('router.builder')->rebuild();

    $route = $this->container->get('router.route_provider')
      ->getRouteByName('view.conductors.user_list');
    self::assertSame('/user/{user}/conductors', $route->getPath());
    self::assertNotContains(
      'view.conductors.user_list',
      $this->tabRoutesOn('entity.user.canonical', $this->accounts['lead']),
    );
  }

  /**
   * Title search matches the label; a blank-label row still has a usable link.
   */
  public function testCollectionSearchAndCanonicalLinks(): void {
    $this->installShippedView('views.view.conductors');
    $this->container->get('account_switcher')->switchTo($this->accounts['lead']);

    $hits = $this->viewResultIds(
      'conductors',
      [(string) $this->accounts['lead']->id()],
      'user_list',
      ['title' => 'Alpha'],
    );
    self::assertSame([(string) $this->labelled->id()], $hits);

    $view = Views::getView('conductors');
    self::assertNotNull($view);
    $view->setDisplay('user_list');
    $view->setArguments([(string) $this->accounts['lead']->id()]);
    $view->preExecute();
    $view->execute();
    $urls = [];
    foreach ($view->result as $row) {
      self::assertInstanceOf(BbConductorInterface::class, $row->_entity);
      $urls[(string) $row->_entity->id()] = $row->_entity->toUrl()->toString();
    }
    self::assertSame(
      '/bakers/conductor/' . $this->labelled->id(),
      $urls[(string) $this->labelled->id()],
    );
    self::assertSame(
      '/bakers/conductor/' . $this->blank->id(),
      $urls[(string) $this->blank->id()],
    );
  }

  /**
   * A same-workspace guest is refused the listing and the Overview.
   */
  public function testGuestIsForbiddenOnListingAndDetail(): void {
    $this->installShippedView('views.view.conductors');
    $this->container->get('router.builder')->rebuild();
    $this->actAs($this->accounts['guest']);

    self::assertSame(403, $this->statusOf('/user/' . $this->accounts['lead']->id() . '/conductors'));
    self::assertSame(403, $this->statusOf('/bakers/conductor/' . $this->labelled->id()));
  }

  /**
   * A member of both workspaces still cannot open a foreign conductor here.
   */
  public function testWrongWorkspaceIs404(): void {
    $this->installShippedView('views.view.conductors');
    $this->container->get('router.builder')->rebuild();
    $this->actAs($this->accounts['lead']);

    self::assertSame(404, $this->statusOf('/other/conductor/' . $this->labelled->id()));
    self::assertSame(404, $this->statusOf('/bakers/conductor/' . $this->foreign->id()));
  }

  /**
   * Unknown slug, unknown conductor, and a broken ownership chain are 404.
   */
  public function testUnknownAndOrphanConductorAre404(): void {
    $this->installShippedView('views.view.conductors');
    $this->container->get('router.builder')->rebuild();
    $this->actAs($this->accounts['lead']);

    self::assertSame(404, $this->statusOf('/bakers/conductors'));
    self::assertSame(404, $this->statusOf('/nope/conductors'));
    self::assertSame(404, $this->statusOf('/nope/conductor/' . $this->labelled->id()));
    self::assertSame(404, $this->statusOf('/bakers/conductor/99999'));
    self::assertSame(404, $this->statusOf('/bakers/conductor/' . $this->orphan->id()));
  }

  /**
   * The full view mode paints the inspector cards.
   */
  public function testFullViewModeRendersTheCards(): void {
    $this->installOverviewDisplay();
    $this->actAs($this->accounts['lead']);
    $html = $this->renderFull($this->labelled);

    self::assertStringContainsString('Project', $html);
    self::assertStringContainsString('bakers.build', $html);
    // One card; the lead owns this conductor. The page shows no status, last
    // seen, load or states.
    self::assertStringContainsString('bb_theme:inspector', $html);
    // The Identity card.
    self::assertSame(1, substr_count($html, 'data-zone-heading'));
    self::assertStringContainsString('Identity', $html);
    $gone = [
      'Configuration', 'Last seen', 'Reported load', 'Live occupancy',
      'No running tickets.', '/card/configuration',
    ];
    foreach ($gone as $text) {
      self::assertStringNotContainsString($text, $html);
    }
    // Disable/Enable is the Identity card's footer, after its form.
    $form = strpos($html, '/conductor/' . $this->labelled->id() . '/card/identity');
    self::assertNotFalse($form);
    self::assertGreaterThan($form, strpos($html, 'Disable conductor'));
  }

  /**
   * Live occupancy follows the claim-seam predicate at a frozen request time.
   *
   * @param string $state
   *   The run state to save.
   * @param int|null $expires
   *   Claim lease timestamp, or NULL for a SQL NULL.
   * @param bool $live
   *   Whether this run occupies a slot.
   */
  #[DataProvider('liveOccupancyCases')]
  public function testLiveOccupancyPredicate(string $state, ?int $expires, bool $live): void {
    $this->freezeTime();
    $this->actAs($this->accounts['lead']);
    $ticket = $this->ticketOn($this->homeProject, 'Case ' . $state . '-' . (string) $expires);
    $this->runOn($this->labelled, $ticket, $state, $expires);

    $html = $this->occupancyHtml($this->labelled);
    self::assertStringContainsString('Live occupancy: ' . ($live ? '1' : '0'), $html);
    if ($live) {
      self::assertStringContainsString($ticket->getIdentifier(), $html);
      self::assertStringContainsString((string) $ticket->label(), $html);
      self::assertStringContainsString('/bakers/ticket/' . mb_strtolower($ticket->getIdentifier()), $html);
    }
    else {
      self::assertStringNotContainsString($ticket->getIdentifier(), $html);
      self::assertStringContainsString('No running tickets.', $html);
    }
  }

  /**
   * Independent occupancy oracle: request time 2000000000.
   *
   * @return array<string, array{0: string, 1: int|null, 2: bool}>
   *   State, claim_expires_at, expected live.
   */
  public static function liveOccupancyCases(): array {
    return [
      'running with past lease' => ['running', 1999999999, TRUE],
      'running with null lease' => ['running', NULL, TRUE],
      'claimed zero sentinel' => ['claimed', 0, TRUE],
      'claimed equal to now' => ['claimed', 2000000000, TRUE],
      'claimed in the future' => ['claimed', 2000000001, TRUE],
      'claimed already expired' => ['claimed', 1999999999, FALSE],
      'claimed sql null' => ['claimed', NULL, FALSE],
      'done with future lease' => ['done', 2000000001, FALSE],
      'failed with future lease' => ['failed', 2000000001, FALSE],
      'expired terminal' => ['expired', 2000000001, FALSE],
      'cancelled terminal' => ['cancelled', 2000000001, FALSE],
    ];
  }

  /**
   * A sibling conductor's live run does not occupy this conductor.
   */
  public function testSiblingConductorRunDoesNotCount(): void {
    $this->freezeTime();
    $this->actAs($this->accounts['lead']);
    $sibling = $this->create('bb_conductor', [
      'conductor_id' => 'reg-sibling',
      'label' => 'Sibling',
      'project_id' => $this->homeProject->id(),
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $sibling);
    $ticket = $this->ticketOn($this->homeProject, 'Sibling live');
    $this->runOn($sibling, $ticket, 'running', self::FROZEN_NOW);

    $html = $this->occupancyHtml($this->labelled);
    self::assertStringContainsString('Live occupancy: 0', $html);
    self::assertStringNotContainsString($ticket->getIdentifier(), $html);
  }

  /**
   * Ticket assignment without a live run is not occupancy.
   */
  public function testAssignedTicketWithoutRunDoesNotCount(): void {
    $this->freezeTime();
    $this->actAs($this->accounts['lead']);
    $ticket = $this->ticketOn($this->homeProject, 'Assigned idle');
    $ticket->set('conductor_id', $this->labelled->id())->save();

    $html = $this->occupancyHtml($this->labelled);
    self::assertStringContainsString('Live occupancy: 0', $html);
    self::assertStringNotContainsString($ticket->getIdentifier(), $html);
    self::assertStringContainsString('No running tickets.', $html);
  }

  /**
   * Duplicate live runs occupy two slots and list the ticket once.
   */
  public function testDuplicateLiveRunsCountSlotsAndDeduplicateTickets(): void {
    $this->freezeTime();
    $this->actAs($this->accounts['lead']);
    $ticket = $this->ticketOn($this->homeProject, 'Duplicate live');
    $this->runOn($this->labelled, $ticket, 'running', self::FROZEN_NOW);
    $this->runOn($this->labelled, $ticket, 'claimed', 0);

    $html = $this->occupancyHtml($this->labelled);
    self::assertStringContainsString('Live occupancy: 2', $html);
    self::assertSame(1, substr_count($html, $ticket->getIdentifier()));
  }

  /**
   * Hidden tickets keep the slot count and emit no identifier.
   */
  public function testInaccessibleTicketKeepsCountAndHidesTheRow(): void {
    $this->freezeTime();
    $ticket = $this->ticketOn($this->otherProject, 'Hidden occupancy');
    $this->runOn($this->labelled, $ticket, 'running', self::FROZEN_NOW);
    $this->actAs($this->accounts['contributor']);

    $html = $this->occupancyHtml($this->labelled);
    self::assertStringContainsString('Live occupancy: 1', $html);
    self::assertStringNotContainsString($ticket->getIdentifier(), $html);
    self::assertStringNotContainsString((string) $ticket->label(), $html);
    self::assertStringContainsString('No running tickets visible to you.', $html);
    self::assertStringNotContainsString('No running tickets.', str_replace('No running tickets visible to you.', '', $html));
  }

  /**
   * A deleted ticket keeps the slot and fabricates no link.
   */
  public function testDeletedTicketKeepsCountAndFabricatesNoLink(): void {
    $this->freezeTime();
    $this->actAs($this->accounts['lead']);
    $ticket = $this->ticketOn($this->homeProject, 'Deleted occupancy');
    $identifier = $ticket->getIdentifier();
    $this->runOn($this->labelled, $ticket, 'running', self::FROZEN_NOW);
    $ticket->delete();

    $html = $this->occupancyHtml($this->labelled);
    self::assertStringContainsString('Live occupancy: 1', $html);
    self::assertStringNotContainsString($identifier, $html);
    self::assertStringContainsString('No running tickets visible to you.', $html);
  }

  /**
   * An idle conductor shows occupancy 0 even when heartbeat load is stale.
   */
  public function testIdleConductorShowsZeroDespiteStaleReportedLoad(): void {
    $this->freezeTime();
    $this->actAs($this->accounts['lead']);
    self::assertSame(2, (int) $this->labelled->get('reported_load')->value);

    $html = $this->occupancyHtml($this->labelled);
    self::assertStringContainsString('Live occupancy: 0', $html);
    self::assertStringContainsString('No running tickets.', $html);
    $element = $this->occupancySource($this->labelled)->alterComponent([]);
    self::assertSame(0, $element['#cache']['max-age'] ?? NULL);
  }

  /**
   * A claim that equals now drops off on the next request, without a save.
   */
  public function testClaimExpiresOnTheNextRequestWithoutSaving(): void {
    $this->freezeTime();
    $this->actAs($this->accounts['lead']);
    $ticket = $this->ticketOn($this->homeProject, 'Lease boundary');
    $this->runOn($this->labelled, $ticket, 'claimed', self::FROZEN_NOW);

    self::assertStringContainsString('Live occupancy: 1', $this->occupancyHtml($this->labelled));
    $this->freezeTime(self::FROZEN_NOW + 1);
    $later = $this->occupancyHtml($this->labelled);
    self::assertStringContainsString('Live occupancy: 0', $later);
    self::assertStringNotContainsString($ticket->getIdentifier(), $later);
  }

  /**
   * Missing, unsaved, or unviewable conductor context yields no occupancy body.
   */
  public function testOccupancySourceEmptyWithoutAccess(): void {
    $this->freezeTime();
    $this->actAs($this->accounts['lead']);
    $unsaved = $this->container->get('entity_type.manager')
      ->getStorage('bb_conductor')
      ->create(['conductor_id' => 'reg-unsaved', 'label' => 'Unsaved']);
    self::assertInstanceOf(BbConductorInterface::class, $unsaved);
    self::assertSame([], $this->occupancySource($unsaved)->getPropValue());

    $this->actAs($this->accounts['guest']);
    self::assertSame([], $this->occupancySource($this->labelled)->getPropValue());
  }

  /**
   * The list item whose headline reads a label.
   */
  private function itemNamed(string $html, string $label): string {
    $items = (new Crawler($html))->filter('li[data-list-item]')
      ->reduce(fn (Crawler $item): bool => str_contains($item->filter('[data-list-region="headline"]')->text(), $label));
    self::assertCount(1, $items, "No single item is named $label.");
    return $items->outerHtml();
  }

  /**
   * The data-cell ids of one region, in order.
   *
   * @return list<string>
   *   The cell ids.
   */
  private function cellIds(string $item, string $region): array {
    return (new Crawler($item))->filter("[data-list-region=\"$region\"] > [data-cell]")->each(
      static fn (Crawler $cell): string => (string) $cell->attr('data-cell'),
    );
  }

  /**
   * The explaining titles of the count badges in the right-hand column.
   *
   * @return list<string>
   *   One title per badge, in order.
   */
  private function badgeTitles(string $item): array {
    return (new Crawler($item))->filter('[data-list-region="right"] [data-component-id="bb_theme:badge"]')->each(
      static fn (Crawler $badge): string => (string) $badge->attr('title'),
    );
  }

  /**
   * One region of an item.
   */
  private function region(string $item, string $region): string {
    $nodes = (new Crawler($item))->filter(sprintf('[data-list-region="%s"]', $region));
    self::assertCount(1, $nodes, "The item has no single $region region.");
    return $nodes->outerHtml();
  }

  /**
   * The route names of the tab row rendered on one route, for one account.
   *
   * @return array<string>
   *   The tab route names the manager built, in its order.
   */
  private function tabRoutesOn(string $route_name, UserInterface $account): array {
    $this->actAs($account);
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $path = $route_name === 'entity.user.canonical'
      ? '/user/' . $account->id()
      : '/bakers/conductor/' . $this->labelled->id();
    $request = Request::create($path);
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $raw = [];
    if (str_contains($route->getPath(), '{user}')) {
      $request->attributes->set('user', $account);
      $raw['user'] = (string) $account->id();
    }
    if (str_contains($route->getPath(), '{bb_workspace}')) {
      $request->attributes->set('bb_workspace', $this->home);
      $raw['bb_workspace'] = $this->home->get('slug')->value;
    }
    if (str_contains($route->getPath(), '{bb_conductor}')) {
      $request->attributes->set('bb_conductor', $this->labelled);
      $raw['bb_conductor'] = (string) $this->labelled->id();
    }
    $request->attributes->set('_raw_variables', new ParameterBag($raw));
    $this->container->get('request_stack')->push($request);

    $manager = $this->container->get('plugin.manager.menu.local_task');
    $manager->clearCachedDefinitions();
    $tabs = [];
    foreach ($manager->getLocalTasks($route_name, 0)['tabs'] as $tab) {
      $tabs[] = $tab['#link']['url']->getRouteName();
    }
    $this->container->get('request_stack')->pop();
    return $tabs;
  }

  /**
   * Runs a request through the real HTTP kernel and returns its status.
   */
  private function statusOf(string $path): int {
    $request = Request::create($path);
    $response = $this->container->get('http_kernel')->handle($request);
    $this->container->get('request_stack')->pop();
    return $response->getStatusCode();
  }

  /**
   * Makes an account the current user for the requests that follow.
   */
  private function actAs(UserInterface $account): void {
    $this->container->get('current_user')->setAccount($account);
  }

  /**
   * The home workspace slug the listing argument validator expects.
   */
  private function homeSlug(): string {
    return (string) $this->home->get('slug')->value;
  }

  /**
   * Creates a user holding exactly the given permissions.
   *
   * @param string $name
   *   Username and role id stem.
   * @param array<string> $permissions
   *   Site-wide permissions granted on a dedicated role.
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
   *
   * @param string $entity_type_id
   *   The entity type to create.
   * @param array<string, mixed> $values
   *   The field values.
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
   * Pins Drupal request time so occupancy leases are deterministic.
   */
  private function freezeTime(int $now = self::FROZEN_NOW): void {
    $stack = $this->container->get('request_stack');
    $request = $stack->getCurrentRequest();
    if ($request === NULL) {
      $request = Request::create('/');
      $request->setSession(new Session(new MockArraySessionStorage()));
      $stack->push($request);
    }
    elseif (!$request->hasSession()) {
      $request->setSession(new Session(new MockArraySessionStorage()));
    }
    $request->server->set('REQUEST_TIME', $now);
    $request->server->set('REQUEST_TIME_FLOAT', (float) $now);
    $this->container->set('datetime.time', new class($now) implements TimeInterface {

      /**
       * Constructs the frozen clock.
       */
      public function __construct(private readonly int $now) {}

      /**
       * {@inheritdoc}
       */
      public function getRequestTime(): int {
        return $this->now;
      }

      /**
       * {@inheritdoc}
       */
      public function getRequestMicroTime(): float {
        return (float) $this->now;
      }

      /**
       * {@inheritdoc}
       */
      public function getCurrentTime(): int {
        return $this->now;
      }

      /**
       * {@inheritdoc}
       */
      public function getCurrentMicroTime(): float {
        return (float) $this->now;
      }

    });
  }

  /**
   * Creates a ticket on a project with a unique title.
   */
  private function ticketOn(ContentEntityInterface $project, string $title): BbTicketInterface {
    $ticket = $this->create('bb_ticket', [
      'title' => $title,
      'state' => 'coding',
      'workflow' => 'bb_feature',
      'project_id' => $project->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * Creates a run occupying a conductor, or not, per state and lease.
   */
  private function runOn(BbConductorInterface $conductor, ContentEntityInterface $ticket, string $state, ?int $expires): ContentEntityInterface {
    $values = [
      'ticket_id' => $ticket->id(),
      'conductor_id' => $conductor->id(),
      'state' => $state,
      'state_at_start' => 'coding',
    ];
    if ($expires !== NULL) {
      $values['claim_expires_at'] = $expires;
    }
    return $this->create('bb_run', $values);
  }

  /**
   * Renders occupancy for one conductor as HTML.
   */
  private function occupancyHtml(BbConductorInterface $conductor): string {
    $source = $this->occupancySource($conductor);
    $this->installShippedView('views.view.conductor_tickets');
    $build = $source->getPropValue();
    self::assertIsArray($build);
    $build = $source->alterComponent($build);
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Instantiates the occupancy source against a conductor.
   */
  private function occupancySource(BbConductorInterface $conductor): ConductorOccupancySource {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_conductor_occupancy',
        SourcePluginBase::buildConfiguration('content', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(ConductorOccupancySource::class, $source);
    $source->setContextValue('entity', $conductor);
    return $source;
  }

  /**
   * Renders the product Overview the way the canonical route does.
   */
  private function renderFull(BbConductorInterface $conductor): string {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->installShippedView('views.view.conductor_tickets');
    $build = $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_conductor')
      ->view($conductor, 'full');
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * The Properties footer build for one conductor and the current account.
   *
   * @return array<string, mixed>
   *   The source's render array.
   */
  private function actionsSource(BbConductorInterface $conductor): array {
    $definition = $this->container->get('plugin.manager.ui_patterns_prop_type')
      ->getDefinition('slot')['schema'];
    $source = $this->container->get('plugin.manager.ui_patterns_source')
      ->createInstance(
        'bb_conductor_actions',
        SourcePluginBase::buildConfiguration('footer', $definition, ['source' => []], []),
      );
    self::assertInstanceOf(SourcePluginBase::class, $source);
    $source->setContextValue('entity', $conductor);
    $build = $source->getPropValue();
    self::assertIsArray($build);
    return $build;
  }

  /**
   * Writes the shipped config objects the `full` view mode needs.
   */
  private function installOverviewDisplay(): void {
    $this->installConfig(['display_builder']);
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    foreach ([
      'core.entity_view_mode.bb_conductor.full' => $module . '/config/optional',
      'core.entity_view_display.bb_conductor.bb_conductor.full' => $recipe,
      'filter.format.bb_rich' => $module . '/config/install',
    ] as $name => $directory) {
      $file = $directory . '/' . $name . '.yml';
      self::assertFileExists($file, sprintf('%s ships on the recipe path.', $name));
      $data = Yaml::decode((string) file_get_contents($file));
      $data = $this->withoutUnknownSources($data);
      $data['uuid'] = $this->container->get('uuid')->generate();
      $target->write($name, $data);
    }
  }

}
