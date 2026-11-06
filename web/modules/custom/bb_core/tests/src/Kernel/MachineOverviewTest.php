<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_core\Controller\RetiredEditSurfaceController;
use Drupal\bb_core\Entity\BbMachineInterface;
use Drupal\bb_core\Routing\BbMachineRouteProvider;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\ParameterBag;
use Symfony\Component\HttpFoundation\Request;

/**
 * Machine product Overview and user-area canonical.
 *
 * Listing names link to Overview at `/user/{user}/machine/{id}`, whose cards
 * edit the machine. Add, edit, delete and the collection stay under
 * `/admin/bakers/machine`.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class MachineOverviewTest extends KernelTestBase {

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
   * A named machine owned by the lead in the home workspace.
   */
  private BbMachineInterface $labelled;

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
      'bb_project', 'bb_machine', 'bb_conductor', 'bb_ticket',
      'bb_run',
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
      'host_key' => 'host-alpha',
      'owner_user_id' => $this->accounts['lead']->id(),
      'max_parallel' => 4,
      'current_load' => 1,
    ]);
    self::assertInstanceOf(BbMachineInterface::class, $labelled);
    $this->labelled = $labelled;

    $this->container->get('router.builder')->rebuild();
  }

  /**
   * The canonical route is the product Overview, not a controller.
   */
  public function testCanonicalRouteRendersTheOwnedMachine(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_machine.canonical');

    self::assertSame('/user/{user}/machine/{bb_machine}', $route->getPath());
    self::assertSame('bb_machine.full', $route->getDefault('_entity_view'));
    self::assertSame('bb_machine.view', $route->getRequirement('_entity_access'));
    self::assertNull($route->getDefault('_controller'));
    self::assertFalse($route->getOption('_admin_route'));
    self::assertSame('entity:user', $route->getOption('parameters')['user']['type'] ?? NULL);
    self::assertSame('TRUE', $route->getRequirement('_bb_machine_owner_match'));
  }

  /**
   * The title callback names the machine, not the workspace ahead of it.
   */
  public function testCanonicalRouteKeepsAnExplicitMachineTitleCallback(): void {
    $route = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_machine.canonical');

    self::assertSame(
      BbMachineRouteProvider::class . '::title',
      $route->getDefault('_title_callback'),
    );
    self::assertSame('Alpha', BbMachineRouteProvider::title($this->labelled));

  }

  /**
   * The former Settings url leads to the Overview's cards.
   */
  public function testFormerSettingsUrlIsRetired(): void {
    $retired = $this->container->get('router.route_provider')
      ->getRouteByName('bb_core.bb_machine.settings');
    self::assertSame('/user/{user}/machine/{bb_machine}/edit', $retired->getPath());
    self::assertSame(RetiredEditSurfaceController::class . '::redirect', $retired->getDefault('_controller'));
    self::assertSame('bb_machine.view', $retired->getRequirement('_entity_access'));
    self::assertSame('TRUE', $retired->getRequirement('_bb_machine_owner_match'));
    self::assertFalse($retired->getOption('_admin_route'));
  }

  /**
   * The instance admin's maintenance form renders in the shell like any route.
   */
  public function testEditFormIsTheAdministrativeForm(): void {
    $edit = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_machine.edit_form');
    self::assertSame('/admin/bakers/machine/{bb_machine}/edit', $edit->getPath());
    self::assertSame('bb_machine.edit', $edit->getDefault('_entity_form'));
    self::assertSame('bb_machine.update', $edit->getRequirement('_entity_access'));
    self::assertFalse($edit->getOption('_admin_route'));
  }

  /**
   * View is the only product tab; admin collection stays put.
   */
  public function testViewAndEditAreTheProductTabsAndAdminCollectionStays(): void {
    $collection = $this->container->get('router.route_provider')
      ->getRouteByName('entity.bb_machine.collection');
    self::assertSame('/admin/bakers/machines', $collection->getPath());

    self::assertSame(
      ['entity.bb_machine.canonical'],
      $this->tabRoutesOn('entity.bb_machine.canonical', $this->accounts['lead']),
    );
    self::assertSame(
      ['View'],
      $this->tabTitlesOn('entity.bb_machine.canonical', $this->accounts['lead']),
    );
  }

  /**
   * The canonical URL sits under the owner's user area; edit is admin.
   */
  public function testProductUrlsAreUserArea(): void {
    $this->actAs($this->accounts['lead']);
    $base = '/user/' . $this->accounts['lead']->id() . '/machine/' . $this->labelled->id();
    self::assertSame($base, $this->labelled->toUrl()->toString());
    self::assertSame('/admin/bakers/machine/' . $this->labelled->id() . '/edit', $this->labelled->toUrl('edit-form')->toString());
  }

  /**
   * Listing names link to the product canonical.
   */
  public function testListingNameLinksToTheEntity(): void {
    $this->installShippedView('views.view.machines');
    $view = $this->container->get('entity_type.manager')->getStorage('view')->load('machines');
    self::assertNotNull($view);
    $fields = $view->get('display')['default']['display_options']['fields'];
    self::assertTrue($fields['name']['settings']['link_to_entity']);
    self::assertArrayNotHasKey('host_key', $fields);
  }

  /**
   * Overview renders host key and capacity.
   */
  public function testOverviewRendersHostKeyAndCapacity(): void {
    $this->installOverviewDisplay();
    $this->container->get('account_switcher')->switchTo($this->accounts['lead']);
    $html = $this->renderFull($this->labelled);
    self::assertStringContainsString('Host key', $html);
    self::assertStringContainsString('host-alpha', $html);
    self::assertStringContainsString('Max parallel', $html);
    self::assertStringContainsString('4', $html);
    self::assertStringContainsString('Current load', $html);
    self::assertStringContainsString('>1<', $html);
    self::assertStringContainsString('Owner', $html);
    self::assertStringNotContainsString('Workspace', $html);

    $this->labelled->setCurrentLoad(0)->save();
    $zero = $this->renderFull($this->labelled);
    self::assertStringContainsString('Current load', $zero);
    self::assertStringContainsString('>0<', $zero);
  }

  /**
   * The owner reaches Overview and is sent there from Edit; others are refused.
   */
  public function testLeadReachesOverviewAndEditAndGuestIsForbidden(): void {
    $overview = '/user/' . $this->accounts['lead']->id() . '/machine/' . $this->labelled->id();
    $edit = $overview . '/edit';

    $this->actAs($this->accounts['lead']);
    self::assertSame(200, $this->statusOf($overview));
    self::assertSame(302, $this->statusOf($edit));

    $this->actAs($this->accounts['contributor']);
    self::assertSame(403, $this->statusOf($overview));
    self::assertSame(403, $this->statusOf($edit));

    $this->actAs($this->accounts['guest']);
    self::assertSame(403, $this->statusOf($overview));
    self::assertSame(403, $this->statusOf($edit));
  }

  /**
   * The admin form locks host key and keeps current load for the admin.
   */
  public function testAdminEditFormKeepsCurrentLoadForTheInstanceAdmin(): void {
    $this->actAs($this->createAccount('instance-admin', ['administer bakers']));
    $form = $this->container->get('entity.form_builder')->getForm($this->labelled, 'edit');

    self::assertArrayHasKey('name', $form);
    self::assertArrayHasKey('max_parallel', $form);
    self::assertFalse($form['host_key']['#access']);
    self::assertSame('host-alpha', $form['host_key_display']['value']['#props']['label']);
    self::assertSame('lock', $form['host_key_display']['value']['#props']['icon']);
    self::assertArrayHasKey('current_load', $form);
    self::assertNotFalse($form['current_load']['#access'] ?? TRUE);
  }

  /**
   * A `{user}` that is not the owner is 404 on View and Settings.
   */
  public function testMismatchedUserPathIsNotFound(): void {
    $owner = '/user/' . $this->accounts['lead']->id() . '/machine/' . $this->labelled->id();
    $foreign = '/user/' . $this->accounts['contributor']->id() . '/machine/' . $this->labelled->id();

    $this->actAs($this->accounts['lead']);
    self::assertSame(200, $this->statusOf($owner));
    self::assertSame(302, $this->statusOf($owner . '/edit'));
    self::assertSame(404, $this->statusOf($foreign));
    self::assertSame(404, $this->statusOf($foreign . '/edit'));
  }

  /**
   * The route names of the tab row rendered on one route, for one account.
   *
   * @return array<string>
   *   The tab route names the manager built, in its order.
   */
  private function tabRoutesOn(string $route_name, UserInterface $account): array {
    return array_values(array_map(
      static fn (array $tab): string => $tab['#link']['url']->getRouteName(),
      $this->localTasksOn($route_name, $account),
    ));
  }

  /**
   * The titles of the tab row rendered on one route, for one account.
   *
   * @return array<string>
   *   The tab titles the manager built, in its order.
   */
  private function tabTitlesOn(string $route_name, UserInterface $account): array {
    return array_values(array_map(
      static fn (array $tab): string => (string) $tab['#link']['title'],
      $this->localTasksOn($route_name, $account),
    ));
  }

  /**
   * The local-task render arrays on one route, for one account.
   *
   * @return array<int|string, array<string, mixed>>
   *   The tabs the manager built, in its order.
   */
  private function localTasksOn(string $route_name, UserInterface $account): array {
    $this->actAs($account);
    $route = $this->container->get('router.route_provider')->getRouteByName($route_name);
    $request = Request::create(
      '/user/' . $this->accounts['lead']->id() . '/machine/' . $this->labelled->id(),
    );
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route_name);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $route);
    $request->attributes->set('user', $this->accounts['lead']);
    $request->attributes->set('bb_machine', $this->labelled);
    $request->attributes->set('_raw_variables', new ParameterBag([
      'user' => (string) $this->accounts['lead']->id(),
      'bb_machine' => (string) $this->labelled->id(),
    ]));
    $this->container->get('request_stack')->push($request);

    $manager = $this->container->get('plugin.manager.menu.local_task');
    $manager->clearCachedDefinitions();
    $tabs = $manager->getLocalTasks($route_name, 0)['tabs'];
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

  /**
   * Renders the product Overview the way the canonical route does.
   */
  private function renderFull(BbMachineInterface $machine): string {
    $this->container->get('theme_installer')->install(['bb_theme']);
    $build = $this->container->get('entity_type.manager')
      ->getViewBuilder('bb_machine')
      ->view($machine, 'full');
    return (string) $this->container->get('renderer')->renderInIsolation($build);
  }

  /**
   * Writes the two shipped config objects the `full` view mode needs.
   */
  private function installOverviewDisplay(): void {
    $this->installConfig(['display_builder']);
    $module = $this->container->get('extension.list.module')->getPath('bb_core');
    $recipe = dirname(DRUPAL_ROOT) . '/recipes/bakers/config';
    $target = $this->container->get('config.storage');
    foreach ([
      'core.entity_view_mode.bb_machine.full' => $module . '/config/optional',
      'core.entity_view_display.bb_machine.bb_machine.full' => $recipe,
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
