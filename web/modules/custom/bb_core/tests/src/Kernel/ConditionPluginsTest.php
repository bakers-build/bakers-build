<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Condition\ConditionInterface;
use Drupal\Core\Condition\ConditionPluginCollection;
use Drupal\Core\Form\FormState;
use Drupal\Core\Plugin\ContextAwarePluginInterface;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\ContextProvider\BbRouteContextProvider;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\Condition\BbUserAreaRoute;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\island\EventSubscriber\IslandActionSubscriber;
use Drupal\island\IslandRuntimeId;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Routing\Route;

/**
 * The bb_core condition plugins decide through core and declare their variance.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ConditionPluginsTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'path_alias', 'user', 'field', 'file', 'image', 'options', 'entity',
    'state_machine', 'link', 'text', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'bb_core', 'views', 'sdc', 'sdc_test', 'island', 'island_test',
  ];

  /**
   * The workspace the rank and workspace conditions are asked about.
   */
  private BbWorkspaceInterface $workspace;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach (['user', 'og_membership', 'bb_workspace', 'bb_team', 'bb_project'] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user']);
    $this->installOgScopeFixture();
    $this->createUser([], 'root');
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'Alpha', 'slug' => 'alpha', 'owner_user_id' => 1]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();
    $this->workspace = $workspace;
  }

  /**
   * Route conditions match exact names, negate through core and vary by route.
   */
  public function testRouteConditions(): void {
    $area = $this->condition('bb_user_area_route', ['enabled' => TRUE]);
    foreach (BbUserAreaRoute::ROUTES as $route) {
      $this->enter($route);
      self::assertTrue($area->execute(), "$route is in the user area.");
    }
    $this->enter('view.tickets.my_work');
    self::assertFalse($area->execute(), 'A workspace route is not in the user area.');
    self::assertTrue($this->condition('bb_user_area_route', ['enabled' => TRUE, 'negate' => TRUE])->execute());
    self::assertContains('route', $area->getCacheContexts());

    $routes = $this->condition('route_name', ['route_names' => ['system.403', 'system.404']]);
    $this->enter('system.404');
    self::assertTrue($routes->execute());
    $this->enter('system.4044');
    self::assertFalse($routes->execute(), 'Route names match exactly, not by prefix.');
    self::assertTrue($this->condition('route_name', ['route_names' => ['system.404'], 'negate' => TRUE])->execute());
    self::assertContains('route', $routes->getCacheContexts());
  }

  /**
   * A positive presence-only condition survives core's default pruning.
   */
  public function testConfiguredConditionsAreSerialized(): void {
    $collection = new ConditionPluginCollection($this->container->get('plugin.manager.condition'), [
      'bb_user_area_route' => ['id' => 'bb_user_area_route', 'enabled' => TRUE],
      'bb_ambient_workspace' => ['id' => 'bb_ambient_workspace', 'enabled' => FALSE],
      'bb_workspace_rank' => ['id' => 'bb_workspace_rank', 'ranks' => ['lead']],
      'route_name' => ['id' => 'route_name', 'route_names' => []],
    ]);
    $configuration = $collection->getConfiguration();
    self::assertSame(['bb_user_area_route', 'bb_workspace_rank'], array_keys($configuration));
    self::assertTrue($configuration['bb_user_area_route']['enabled']);
    self::assertSame(['lead'], $configuration['bb_workspace_rank']['ranks']);
  }

  /**
   * The ambient workspace resolves on workspace routes and nowhere else.
   */
  public function testAmbientWorkspace(): void {
    $this->enter('view.tickets.my_work', ['bb_workspace' => $this->workspace]);
    $present = $this->mapped('bb_ambient_workspace', ['enabled' => TRUE]);
    self::assertTrue($present->execute());
    self::assertContains('bb_workspace', $present->getCacheContexts());
    self::assertContains('route', $present->getCacheContexts(), 'The mapped context carries its own variance.');
    self::assertSame((string) $this->workspace->id(), $this->container->get('cache_context.bb_workspace')->getContext());

    $this->enter('entity.user.canonical');
    self::assertFalse($this->mapped('bb_ambient_workspace', ['enabled' => TRUE])->execute(), 'No workspace is a legitimate false.');
    self::assertTrue($this->mapped('bb_ambient_workspace', ['enabled' => TRUE, 'negate' => TRUE])->execute());
    self::assertSame('none', $this->container->get('cache_context.bb_workspace')->getContext());

    $route_workspace = $this->mapped('bb_ambient_workspace', [
      'enabled' => TRUE,
      'context_mapping' => ['workspace' => '@bb_core.route_context:workspace'],
    ]);
    self::assertFalse($route_workspace->execute(), 'An explicit route mapping reads the route parameter.');
  }

  /**
   * Ranks come from the active membership in the mapped workspace only.
   */
  public function testWorkspaceRank(): void {
    $lead = $this->member('lead', ['lead']);
    $contributor = $this->member('contributor', ['contributor']);
    $guest = $this->member('guest', ['guest']);
    $peer = $this->member('peer', ['contributor']);
    $outsider = $this->createUser([], 'outsider');
    $admin = $this->createUser(['administer site configuration', 'administer users'], 'admin');
    $blocked = $this->member('blocked', ['lead']);
    $this->addMembership($this->workspace, $blocked, ['lead'])->setState(OgMembershipInterface::STATE_BLOCKED)->save();
    $this->container->get('cache.static')->deleteAll();

    $expected = [
      'lead' => [$lead],
      'contributor' => [$contributor, $peer],
      'guest' => [$guest],
      'non-member' => [$outsider, $admin, $blocked],
    ];
    $this->enter('view.tickets.my_work', ['bb_workspace' => $this->workspace]);
    foreach ($expected as $rank => $accounts) {
      foreach ([$lead, $contributor, $guest, $peer, $outsider, $admin, $blocked] as $account) {
        self::assertInstanceOf(UserInterface::class, $account);
        $this->setCurrentUser($account);
        $this->container->get('cache.static')->deleteAll();
        self::assertSame(
          in_array($account, $accounts, TRUE),
          $this->mapped('bb_workspace_rank', ['ranks' => [$rank]])->execute(),
          sprintf('%s ranks as %s: %s', $account->getAccountName(), $rank, in_array($account, $accounts, TRUE) ? 'yes' : 'no'),
        );
      }
    }
    $this->setCurrentUser($contributor);
    self::assertTrue($this->mapped('bb_workspace_rank', ['ranks' => ['lead', 'contributor']])->execute(), 'Any selected rank matches.');
    $condition = $this->mapped('bb_workspace_rank', ['ranks' => ['lead']]);
    foreach (['bb_workspace', 'user', 'user.roles'] as $context) {
      self::assertContains($context, $condition->getCacheContexts());
    }
    self::assertContains('og_membership_list', $condition->getCacheTags());

    $other = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'Beta', 'slug' => 'beta', 'owner_user_id' => 1]);
    $other->save();
    $this->enter('view.tickets.my_work', ['bb_workspace' => $other]);
    self::assertFalse($this->mapped('bb_workspace_rank', ['ranks' => ['contributor']])->execute(), 'A rank in workspace A is no rank in workspace B.');
    self::assertSame((string) $other->id(), $this->container->get('cache_context.bb_workspace')->getContext(), 'The decision varies by workspace.');

    $this->enter('entity.user.canonical');
    self::assertFalse($this->mapped('bb_workspace_rank', ['ranks' => ['non-member']])->execute(), 'No workspace has no rank.');
  }

  /**
   * One profile shows the account placement in the user area only.
   */
  public function testUserAreaPlacementUnderOneProfile(): void {
    App::create(['id' => 'shell', 'label' => 'Shell'])->save();
    $profile = IslandProfile::create([
      'id' => 'shell',
      'label' => 'Shell',
      'app' => 'shell',
      'layout' => 'sdc_test:my-banner',
      'layout_settings' => [
        'heading' => 'Shell',
        'ctaText' => 'Home',
        'ctaHref' => 'https://example.com',
        'ctaTarget' => '',
      ],
      'placements' => [
        'account' => [
          'plugin_id' => 'test_island',
          'slot' => 'banner_body',
          'data' => ['marker' => 'account'],
          'conditions' => [
            'bb_user_area_route' => ['id' => 'bb_user_area_route', 'negate' => FALSE, 'enabled' => TRUE],
          ],
        ],
        'lead' => [
          'plugin_id' => 'test_island',
          'slot' => 'banner_body',
          'data' => ['marker' => 'lead'],
          'conditions' => [
            'bb_workspace_rank' => ['id' => 'bb_workspace_rank', 'negate' => FALSE, 'ranks' => ['lead']],
          ],
        ],
      ],
    ]);
    $profile->save();
    self::assertContains('bb_core', $profile->getDependencies()['module']);
    $lead = $this->member('lead', ['lead']);
    $this->setCurrentUser($lead);

    $this->enter('entity.user.canonical', ['user' => $lead]);
    $build = $this->container->get('island.profile_renderer')->render($profile, 'page');
    self::assertArrayHasKey('account', $build['#slots']['banner_body'] ?? [], 'The account placement shows on the user page.');
    self::assertArrayNotHasKey('lead', $build['#slots']['banner_body'] ?? [], 'No workspace, no rank.');

    $this->enter('view.tickets.my_work', ['bb_workspace' => $this->workspace]);
    $build = $this->container->get('island.profile_renderer')->render($profile, 'page');
    self::assertArrayNotHasKey('account', $build['#slots']['banner_body'] ?? [], 'Not in a workspace, under the same profile.');
    self::assertArrayHasKey('lead', $build['#slots']['banner_body'] ?? []);
    $contexts = CacheableMetadata::createFromRenderArray($build)->getCacheContexts();
    foreach (['route', 'bb_workspace', 'user.roles'] as $context) {
      self::assertContains($context, $contexts);
    }
  }

  /**
   * A cached rank placement never crosses workspaces or memberships.
   *
   * Route name and site roles stay fixed; only the mapped workspace, then only
   * the member, changes between the cached renders.
   */
  public function testCachedRankPlacementNeverCrossesWorkspacesOrMembers(): void {
    App::create(['id' => 'shell', 'label' => 'Shell'])->save();
    $profile = IslandProfile::create([
      'id' => 'shell',
      'label' => 'Shell',
      'app' => 'shell',
      'layout' => 'sdc_test:my-banner',
      'layout_settings' => [
        'heading' => 'Shell',
        'ctaText' => 'Home',
        'ctaHref' => 'https://example.com',
        'ctaTarget' => '',
      ],
      'placements' => [
        'lead' => [
          'plugin_id' => 'test_island',
          'slot' => 'banner_body',
          'data' => ['marker' => 'lead'],
          'conditions' => [
            'bb_workspace_rank' => ['id' => 'bb_workspace_rank', 'negate' => FALSE, 'ranks' => ['lead']],
          ],
        ],
      ],
    ]);
    $profile->save();
    $other = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'Beta', 'slug' => 'beta', 'owner_user_id' => 1]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $other);
    $other->save();
    $lead = $this->member('lead', ['lead']);
    $contributor = $this->member('contributor', ['contributor']);
    self::assertSame($lead->getRoles(), $contributor->getRoles(), 'Both members share their site roles.');

    $markup = function (UserInterface $account, BbWorkspaceInterface $workspace) use ($profile): string {
      $this->setCurrentUser($account);
      $this->enter('view.tickets.my_work', ['bb_workspace' => $workspace]);
      $build = $this->container->get('island.profile_renderer')->render($profile, 'page');
      // The slot alone, under the profile's own cacheability: the test banner
      // layout does not render in this module set.
      $slot = ['slot' => $build['#slots']['banner_body'] ?? [], '#cache' => $build['#cache']];
      $slot['#cache']['keys'] = ['bb_rank_isolation'];
      return (string) $this->container->get('renderer')->renderInIsolation($slot);
    };
    $marker = 'test-island:lead';
    self::assertStringContainsString($marker, $markup($lead, $this->workspace));
    self::assertStringNotContainsString($marker, $markup($lead, $other), 'Workspace B never receives the output cached for A.');
    self::assertStringContainsString($marker, $markup($lead, $this->workspace), 'Workspace A is served its own output again.');
    self::assertStringNotContainsString($marker, $markup($contributor, $this->workspace), 'A member with the same site roles never receives the lead output.');
    self::assertStringContainsString($marker, $markup($lead, $this->workspace));
  }

  /**
   * An island action is checked against the page it was posted to, query too.
   *
   * The own profile resolves its ambient workspace from `?workspace=`, so an
   * action on a workspace-conditioned placement there needs the page query.
   */
  public function testActionOnAmbientWorkspacePlacementSeesThePageQuery(): void {
    // The account page checks workspace read scope, which reads groups.
    $this->installEntitySchema('bb_group');
    View::create([
      'id' => 'tickets',
      'label' => 'Ticket navigation',
      'base_table' => 'users_field_data',
      'base_field' => 'uid',
      'display' => [
        'default' => [
          'id' => 'default',
          'display_plugin' => 'default',
          'display_options' => ['access' => ['type' => 'none']],
        ],
        'my_work' => [
          'id' => 'my_work',
          'display_plugin' => 'page',
          'display_options' => ['path' => '_workspace/%bb_workspace/tickets'],
        ],
      ],
    ])->save();
    $this->container->get('router.builder')->rebuild();
    App::create(['id' => 'shell', 'label' => 'Shell'])->save();
    IslandProfile::create([
      'id' => 'shell',
      'label' => 'Shell',
      'app' => 'shell',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'tasks' => [
          'plugin_id' => 'task_list',
          'slot' => 'banner_body',
          'data' => ['count' => 3],
          'conditions' => [
            'bb_ambient_workspace' => ['id' => 'bb_ambient_workspace', 'negate' => FALSE, 'enabled' => TRUE],
          ],
        ],
      ],
    ])->save();
    $lead = $this->member('lead', ['lead']);
    $this->setCurrentUser($lead);
    $vals = [
      IslandActionSubscriber::ISLAND => 'tasks',
      IslandActionSubscriber::ACTION => 'delete',
      IslandActionSubscriber::HOST => IslandRuntimeId::forHost('shell', 'shell', 'page'),
      IslandActionSubscriber::TOKEN => $this->container->get('csrf_token')->get(IslandActionSubscriber::tokenSeed('tasks', 'delete')),
    ];
    $act = function (array $query) use ($lead, $vals): bool {
      $request = $this->enter('entity.user.canonical', ['user' => $lead], $query);
      $request->setMethod('POST');
      $request->request->replace($vals);
      $event = new RequestEvent($this->container->get('http_kernel'), $request, HttpKernelInterface::MAIN_REQUEST);
      try {
        $this->container->get('island.action_subscriber')->onRequest($event);
      }
      catch (AccessDeniedHttpException) {
        return FALSE;
      }
      return $event->getResponse()?->getStatusCode() === 200;
    };
    self::assertTrue($act(['workspace' => $this->workspace->uuid()]), 'The own profile with its workspace shows the placement, so its action runs.');
    self::assertFalse($act([]), 'Without the workspace query the placement is hidden, so its action is denied.');
  }

  /**
   * A context mapping is asked for only by a condition that is used.
   *
   * The route user joins the current user, so core offers a choice for
   * user_role. An unused condition must not block saving the profile.
   */
  public function testConditionFormsRequireMappingOnlyForUsedConditions(): void {
    App::create(['id' => 'shell', 'label' => 'Shell'])->save();
    $profile = IslandProfile::create([
      'id' => 'shell',
      'label' => 'Shell',
      'app' => 'shell',
      'layout' => 'sdc_test:my-banner',
    ]);
    $profile->save();
    $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
    $form_object->setEntity($profile);
    $form = $this->container->get('form_builder')->getForm($form_object);
    $select = $form['visibility']['conditions']['user_role']['context_mapping']['user'];
    self::assertSame('select', $select['#type'], 'Both user contexts are offered.');
    self::assertFalse($select['#required']);

    $plugin_form = $this->condition('bb_route_context', [])->buildConfigurationForm([], new FormState());
    self::assertTrue($plugin_form['entity_type']['#required'], 'The plugin keeps its own required field for other host forms.');
    self::assertFalse($form['visibility']['conditions']['bb_route_context']['entity_type']['#required'], 'The profile form asks it only of a used condition.');

    $submit = function (array $user_role, array $others = []): array {
      $state = (new FormState())->setValues([
        'op' => 'Save',
        'label' => 'Shell',
        'app' => 'shell',
        'layout' => 'sdc_test:my-banner',
        'visibility' => ['condition_operator' => 'and', 'conditions' => ['user_role' => $user_role] + $others],
      ]);
      $form_object = $this->container->get('entity_type.manager')->getFormObject('island_profile', 'edit');
      $form_object->setEntity(IslandProfile::load('shell'));
      $this->container->get('form_builder')->submitForm($form_object, $state);
      return $state->getErrors();
    };
    self::assertSame([], $submit(['roles' => [], 'context_mapping' => ['user' => '']]), 'An unused condition needs no mapping.');
    $unused = ['roles' => [], 'context_mapping' => ['user' => '']];
    self::assertSame([], $submit($unused, ['bb_route_context' => ['entity_type' => '', 'negate' => FALSE]]), 'An unused condition needs none of its required fields.');
    self::assertNotSame([], $submit($unused, ['bb_route_context' => ['entity_type' => '', 'negate' => TRUE]]), 'A used condition needs its required fields.');
    $roles = ['authenticated' => 'authenticated'];
    self::assertNotSame([], $submit(['roles' => $roles, 'context_mapping' => ['user' => '']]), 'A used condition needs its mapping.');
    $current = '@user.current_user_context:current_user';
    self::assertSame([], $submit(['roles' => $roles, 'context_mapping' => ['user' => $current]]));
    $this->container->get('entity_type.manager')->getStorage('island_profile')->resetCache();
    self::assertSame(['user' => $current], IslandProfile::load('shell')->getConditions()['user_role']['context_mapping']);
  }

  /**
   * The provider offers its three contexts for mapping.
   */
  public function testContextsAreAvailableForMapping(): void {
    $available = $this->container->get('context.repository')->getAvailableContexts();
    foreach (['workspace', 'user', 'ambient_workspace'] as $id) {
      self::assertArrayHasKey('@bb_core.route_context:' . $id, $available);
    }
    self::assertArrayHasKey(BbRouteContextProvider::AMBIENT_WORKSPACE, $available, 'The default mapping names a real context.');
  }

  /**
   * Creates an unmapped condition through core's manager.
   */
  private function condition(string $id, array $configuration): ConditionInterface {
    $condition = $this->container->get('plugin.manager.condition')->createInstance($id, $configuration);
    self::assertInstanceOf(ConditionInterface::class, $condition);
    return $condition;
  }

  /**
   * Creates a condition with its runtime contexts applied, as consumers do.
   */
  private function mapped(string $id, array $configuration): ConditionInterface {
    $condition = $this->condition($id, $configuration);
    self::assertInstanceOf(ContextAwarePluginInterface::class, $condition);
    $mapping = array_filter($condition->getContextMapping());
    $contexts = $this->container->get('context.repository')->getRuntimeContexts(array_values($mapping));
    $this->container->get('context.handler')->applyContextMapping($condition, $contexts);
    return $condition;
  }

  /**
   * Creates an account with an active membership holding the given ranks.
   */
  private function member(string $name, array $ranks): UserInterface {
    $account = $this->createUser([], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    $this->addMembership($this->workspace, $account, $ranks);
    return $account;
  }

  /**
   * Enters a route with the given upcast parameters.
   */
  private function enter(string $route, array $parameters = [], array $query = []): Request {
    $request = Request::create('/condition-test', 'GET', $query);
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current?->hasSession()) {
      $request->setSession($current->getSession());
    }
    // Route matches expose only the parameters the route path declares.
    $path = '/condition-test' . implode('', array_map(static fn (string $name): string => '/{' . $name . '}', array_keys($parameters)));
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, new Route($path));
    $request->attributes->add($parameters);
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();
    // Core's context repository memoizes per request; this test replays many,
    // so every service holding it starts fresh.
    $services = [
      'context.repository',
      'island.condition_evaluator',
      'island.profile_renderer',
      'island.host_resolver',
      'island.action_subscriber',
    ];
    foreach ($services as $service) {
      $this->container->set($service, NULL);
    }
    return $request;
  }

}
