<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\user\UserInterface;
use Drupal\views\Views;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\DomCrawler\Crawler;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;

/**
 * The user-area Machines listing is this account's machines.
 *
 * BB-619. Machines (`view.machines.user_list`) is a user-area rail item,
 * not a local task. There is no project Machines tab.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MachineUserListingTest extends KernelTestBase {

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
    'field', 'og', 'island', 'link', 'text', 'views',
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
   * A named machine owned by the lead.
   */
  private BbMachineInterface $labelled;

  /**
   * A second lead-owned machine.
   */
  private BbMachineInterface $foreign;

  /**
   * A machine with no owner.
   */
  private BbMachineInterface $orphan;

  /**
   * A machine owned by the contributor.
   */
  private BbMachineInterface $colleague;

  /**
   * Ranked accounts in the home workspace.
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
      'bb_project', 'bb_machine', 'bb_conductor',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'views']);
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();
    $this->installOgScopeFixture();
    $this->createAccount('root', []);

    $this->home = $this->create('bb_workspace', ['name' => 'bakers.build', 'slug' => 'bakers']);

    foreach (['lead', 'contributor', 'guest'] as $rank) {
      $account = $this->createAccount($rank, []);
      $this->addMembership($this->home, $account, [$rank]);
      $this->accounts[$rank] = $account;
    }

    $labelled = $this->create('bb_machine', [
      'name' => 'Alpha',
      'owner_user_id' => $this->accounts['lead']->id(),
      'max_parallel' => 4,
      'current_load' => 1,
    ]);
    self::assertInstanceOf(BbMachineInterface::class, $labelled);
    $this->labelled = $labelled;

    $colleague = $this->create('bb_machine', [
      'name' => 'Colleague',
      'owner_user_id' => $this->accounts['contributor']->id(),
    ]);
    self::assertInstanceOf(BbMachineInterface::class, $colleague);
    $this->colleague = $colleague;

    $foreign = $this->create('bb_machine', [
      'name' => 'Foreign',
      'owner_user_id' => $this->accounts['lead']->id(),
    ]);
    self::assertInstanceOf(BbMachineInterface::class, $foreign);
    $this->foreign = $foreign;

    $orphan = $this->create('bb_machine', [
      'name' => 'Orphan',
    ]);
    self::assertInstanceOf(BbMachineInterface::class, $orphan);
    $this->orphan = $orphan;

    $this->create('bb_conductor', [
      'label' => 'Alpha node',
      'machine' => $this->labelled->id(),
      'owner_user_id' => $this->accounts['lead']->id(),
      'last_seen' => $this->container->get('datetime.time')->getRequestTime() - 86400,
    ]);

    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The user listing is the URL account's machines.
   */
  public function testUserListingIsThisAccountsMachines(): void {
    $this->installShippedView('views.view.machines');
    $this->container->get('account_switcher')->switchTo($this->accounts['lead']);

    $lead_ids = $this->viewResultIds(
      'machines',
      [(string) $this->accounts['lead']->id()],
      'user_list',
    );
    self::assertEqualsCanonicalizing(
      [
        (string) $this->labelled->id(),
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
        'machines',
        [(string) $this->accounts['contributor']->id()],
        'user_list',
      ),
    );
  }

  /**
   * The user-list display lives at `/user/{user}/machines`, not as a tab.
   */
  public function testUserListIsNotLocalTask(): void {
    $this->installShippedView('views.view.machines');
    $this->container->get('router.builder')->rebuild();

    $route = $this->container->get('router.route_provider')
      ->getRouteByName('view.machines.user_list');
    self::assertSame('/user/{user}/machines', $route->getPath());
    self::assertNotContains(
      'view.machines.user_list',
      $this->tabRoutesOn('entity.user.canonical', $this->accounts['lead']),
    );
  }

  /**
   * The machines view has no project listing.
   */
  public function testMachinesViewHasNoProjectList(): void {
    $this->installShippedView('views.view.machines');
    $view = $this->container->get('entity_type.manager')->getStorage('view')->load('machines');
    self::assertNotNull($view);
    self::assertArrayNotHasKey('project_list', $view->get('display'));
  }

  /**
   * Name search matches the machine name.
   */
  public function testCollectionSearch(): void {
    $this->installShippedView('views.view.machines');
    $this->container->get('account_switcher')->switchTo($this->accounts['lead']);

    $hits = $this->viewResultIds(
      'machines',
      [(string) $this->accounts['lead']->id()],
      'user_list',
      ['title' => 'Alpha'],
    );
    self::assertSame([(string) $this->labelled->id()], $hits);
  }

  /**
   * A same-workspace guest is refused the listing.
   */
  public function testGuestIsForbiddenOnListing(): void {
    $this->installShippedView('views.view.machines');
    $this->container->get('router.builder')->rebuild();
    $this->actAs($this->accounts['guest']);

    self::assertSame(403, $this->statusOf('/user/' . $this->accounts['lead']->id() . '/machines'));
  }

  /**
   * A row puts max parallel and load on the right, owner and last run below.
   */
  public function testRowPutsCapacityOnTheRight(): void {
    $this->installShippedView('views.view.machines');
    $this->container->get('account_switcher')->switchTo($this->accounts['lead']);

    $view = Views::getView('machines');
    $view->setDisplay('user_list');
    $view->setArguments([(string) $this->accounts['lead']->id()]);
    $view->preExecute();
    $view->execute();
    $build = $view->style_plugin->render();
    $html = (string) $this->container->get('renderer')->renderInIsolation($build);
    $item = $this->itemNamed($html, 'Alpha');

    self::assertSame(['max_parallel', 'current_load'], $this->cellIds($item, 'right'));
    self::assertSame(['4 parallel slots', '1 load'], $this->badgeTitles($item));
    $right_meta = $this->region($item, 'right_meta');
    self::assertStringContainsString('Owner', $right_meta);
    self::assertStringContainsString('lead', $right_meta);
    self::assertStringContainsString('Last run', $right_meta);
    self::assertMatchesRegularExpression('/\\d+ \\w+ ago/', $right_meta);
  }

  /**
   * The listing name field links to the product canonical.
   */
  public function testListingNameLinksToTheEntity(): void {
    $this->installShippedView('views.view.machines');
    $view = $this->container->get('entity_type.manager')->getStorage('view')->load('machines');
    self::assertNotNull($view);
    $fields = $view->get('display')['default']['display_options']['fields'];
    self::assertTrue($fields['name']['settings']['link_to_entity']);
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
    $request = Request::create('/user/' . $account->id());
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('user', $account);
    $request->attributes->set('_raw_variables', new ParameterBag([
      'user' => (string) $account->id(),
    ]));
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
   * Creates a user holding exactly the given permissions.
   *
   * @param string $name
   *   The account name.
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
   *   The entity type id.
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

}
