<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Kernel;

use Drupal\island\IslandRuntimeId;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\island\EventSubscriber\IslandActionSubscriber;
use Drupal\island\Entity\App;
use Drupal\island\Entity\IslandProfile;
use Drupal\island\IslandProfileHost;
use Drupal\island\IslandResponse;
use Drupal\island_test\ProfileAppProvider;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Yaml\Yaml;

/**
 * Exercises persisted placement identities through public response boundaries.
 */
#[Group('island')]
final class AppProfileRuntimeTest extends KernelTestBase {

  use ProfileRequestTrait;

  /**
   * The host id of the profile's `one` instance.
   */
  private const HOST = 'profile_5b2272756e74696d65222c2270726f66696c65222c226f6e65225d';

  /**
   * {@inheritdoc}
   */
  protected static $modules = ['system', 'path_alias', 'user', 'sdc', 'sdc_test', 'island', 'island_test'];

  /**
   * The fixture's current access policy.
   */
  private ProfileAppProvider $provider;

  /**
   * The persisted profile under test.
   */
  private IslandProfile $profile;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('path_alias');
    $this->provider = new ProfileAppProvider();
    $this->container->get('island.app_provider_manager')->addProvider($this->provider);
    App::create(['id' => 'runtime', 'label' => 'Runtime', 'provider' => 'profile_test'])->save();
    $this->profile = IslandProfile::create([
      'id' => 'profile',
      'label' => 'Profile',
      'app' => 'runtime',
      'layout' => 'sdc_test:my-banner',
      'placements' => [
        'action' => ['plugin_id' => 'task_list', 'slot' => 'banner_body'],
        'first' => [
          'plugin_id' => 'task_count',
          'slot' => 'banner_body',
          'data' => ['count' => 11],
          'events' => ['tasks.changed'],
        ],
        'second' => [
          'plugin_id' => 'task_count',
          'slot' => 'banner_body',
          'data' => ['count' => 22],
          'events' => ['tasks.other'],
        ],
        'disabled' => ['plugin_id' => 'task_count', 'slot' => 'banner_body', 'enabled' => FALSE],
      ],
    ]);
    $this->profile->save();
  }

  /**
   * Responses preserve the exact instance and configured subscriptions.
   */
  public function testRepeatedPlacementEventsStayWithinOneProfileInstance(): void {
    $renderer = $this->container->get('island.profile_renderer');
    $renderer->registerHost($this->profile, 'two');
    $host = $renderer->registerHost($this->profile, 'one');
    self::assertInstanceOf(IslandProfileHost::class, $host);
    $trigger = $this->container->get('island.placement')->createIsland('action', $host);
    $response = IslandResponse::make()->rebuildSelf()->dispatch('tasks.changed', ['count' => 17]);
    $http = $this->container->get('island.responder')->toResponse($response, $trigger, $host);
    preg_match_all('/id="(island-[^"]+)"/', (string) $http->getContent(), $matches);
    self::assertSame([
      'island-profile_5b2272756e74696d65222c2270726f66696c65222c226f6e65225d-action',
      'island-profile_5b2272756e74696d65222c2270726f66696c65222c226f6e65225d-first',
    ], $matches[1]);
    self::assertStringContainsString('count:17', (string) $http->getContent());
    $this->provider->denied = ['first'];
    $http = $this->container->get('island.responder')->toResponse($response, $trigger, $host);
    preg_match_all('/id="(island-[^"]+)"/', (string) $http->getContent(), $matches);
    self::assertSame(['island-profile_5b2272756e74696d65222c2270726f66696c65222c226f6e65225d-action'], $matches[1]);
    self::assertContains('profile_test:access', $http->getCacheableMetadata()->getCacheTags());
    self::assertContains('user.permissions', $http->getCacheableMetadata()->getCacheContexts());
  }

  /**
   * A fresh action request reconstructs the persisted profile host by identity.
   */
  public function testColdRequestResolvesProfileHost(): void {
    $this->container->get('request_stack')->push(Request::create('/island-test', 'POST'));
    $host_id = IslandRuntimeId::forHost('runtime', 'profile', 'fresh');
    $host = $this->container->get('island.host_resolver')->resolve($host_id);
    self::assertInstanceOf(IslandProfileHost::class, $host);
    self::assertSame('fresh', $host->getInstanceId());
    self::assertSame(['action', 'first', 'second'], $host->getIslandIds());
    $this->profile->disable()->save();
    $other_id = IslandRuntimeId::forHost('runtime', 'profile', 'other');
    self::assertNull($this->container->get('island.host_resolver')->resolve($other_id));
    $this->container->get('request_stack')->pop();
  }

  /**
   * Menu navigation targets this instance's configured page-content placement.
   */
  public function testMenuTargetsPageContentInItsOwnInstance(): void {
    $this->profile->set('placements', [
      'nav' => ['plugin_id' => 'menu', 'slot' => 'banner_body'],
      'body' => ['plugin_id' => 'page_content', 'slot' => 'banner_body'],
    ]);
    $this->profile->save();
    $host = $this->container->get('island.profile_renderer')->registerHost($this->profile, 'one');
    $menu = $this->container->get('island.placement')->createIsland('nav', $host);
    $boost = $menu->boost();
    self::assertNotNull($boost);
    $build = ['#attributes' => ['id' => $menu->getHtmlId($host->hostId())]];
    $boost->applyTo($build);
    $attributes = $build['#attributes'];
    self::assertSame('#island-profile_5b2272756e74696d65222c2270726f66696c65222c226f6e65225d-body', $attributes['data-hx-target']);
  }

  /**
   * Render cacheability includes denied and allowed access decisions.
   */
  public function testProfileRenderBubblesAccessCacheability(): void {
    $this->provider->denied = ['first'];
    $build = $this->container->get('island.profile_renderer')->render($this->profile, 'one');
    $cache = CacheableMetadata::createFromRenderArray($build);
    self::assertContains('profile_test:access', $cache->getCacheTags());
    self::assertContains('user.permissions', $cache->getCacheContexts());
    self::assertSame(37, $cache->getCacheMaxAge());
    self::assertArrayNotHasKey('first', $build['#slots']['banner_body']);
  }

  /**
   * An action cannot use a plugin's allow decision to bypass placement access.
   */
  public function testActionRechecksCurrentPlacementAccess(): void {
    self::assertTrue($this->act('/island-test'));
    $this->provider->denied = ['action'];
    self::assertFalse($this->act('/island-test'));
  }

  /**
   * Plugin construction rejects disabled profile placements.
   */
  public function testDisabledPlacementCannotBeConstructed(): void {
    $host = $this->container->get('island.profile_renderer')->registerHost($this->profile, 'one');
    $this->expectException(\LogicException::class);
    $this->container->get('island.placement')->createIsland('disabled', $host);
  }

  /**
   * Shipped entry conditions select the entry surface and nothing beyond it.
   *
   * THE POSITIVE LIST GREW WITH BB-430, and the reason is a product change
   * rather than a widened test. The gate used to frame two paths because there
   * were two entry pages; passwordless sign-up added four more, and each is a
   * screen an anonymous or just-signed-in person meets before they reach the
   * application shell: the entry form is mounted on BOTH `user.login` and
   * `user.register`, `/user/check-mail` is the confirmation, `/user/reset/*`
   * is the one-time link's own two hops, and `/home/new-workspace` and
   * `/home/join/*` are where a tenancy is created or joined.
   *
   * `/user/register` MOVED FROM THE NEGATIVE LIST TO THE POSITIVE ONE. It was
   * asserted as ungated when it was core's own register form and nothing this
   * product owned; it now renders `BbLoginForm`, so leaving it unframed would
   * show the same form with and without the gate depending on which address
   * the visitor typed.
   *
   * THE NEGATIVE LIST IS WHAT THIS TEST IS ACTUALLY FOR, and it is unchanged in
   * substance. `/user/password` stays out because `user.pass` is still core's
   * form and this ticket deliberately did not touch it; `/user/login/extra`
   * stays out because the non-wildcard entries must match EXACTLY, which is
   * what stops a path condition from swallowing a subtree; and
   * `/_workspace/bakers/tickets` stays out because the application shell is a
   * different profile and a gate that framed it would replace the whole
   * product chrome.
   */
  public function testShippedGateConditionsSelectOnlyEntryPages(): void {
    $root = dirname(__DIR__, 7);
    $data = Yaml::parseFile($root . '/recipes/bakers/config/island.profile.bb_gate.yml');
    $this->profile->set('conditions', $data['conditions'])->set('condition_operator', $data['condition_operator'])->save();
    $app = App::load('runtime');
    $framed = [
      '/home',
      '/home/join',
      '/home/join/42',
      '/user/login',
      '/user/register',
      '/user/check-mail',
      '/user/reset/7/1788949193/abc',
    ];
    foreach ($framed as $path) {
      $this->enterPath($path);
      self::assertSame(
        'profile',
        $this->container->get('island.profile_selector')->select($app)?->id(),
        sprintf('%s is part of the entry surface and must carry the gate.', $path),
      );
    }
    foreach (['/user/password', '/user/login/extra', '/_workspace/bakers/tickets'] as $path) {
      $this->enterPath($path);
      self::assertNull(
        $this->container->get('island.profile_selector')->select($app),
        sprintf('%s is not an entry page and must not be framed.', $path),
      );
    }
  }

  /**
   * Direct island requests cannot reach a placement its conditions hide.
   *
   * An action posts to the page that shows its link, so its placement
   * conditions see that page.
   */
  public function testHiddenPlacementDeniesColdHostRequests(): void {
    $placements = $this->profile->get('placements');
    $placements['action']['conditions'] = self::pages('/island-test');
    $this->profile->set('placements', $placements)->save();

    self::assertTrue($this->act('/island-test'), 'An action on a page that shows the placement is allowed.');
    self::assertFalse($this->act('/island-test-other'), 'A cold action host rechecks visibility.');
    $host = $this->container->get('island.host_resolver')->resolve(self::HOST);
    self::assertInstanceOf(IslandProfileHost::class, $host);
    $access = $host->accessIsland('action', $this->container->get('current_user'));
    self::assertFalse($access->isAllowed(), 'A refresh asks the same question.');
    self::assertContains('url.path', CacheableMetadata::createFromObject($access)->getCacheContexts());
    self::assertTrue($host->accessIsland('first', $this->container->get('current_user'))->isAllowed(), 'Unconditioned placements are unaffected.');

    $this->provider->denied = ['action'];
    self::assertFalse($this->act('/island-test'), 'Visibility never grants what the provider denies.');
  }

  /**
   * Posts the `action` placement's delete action to a page.
   *
   * @return bool
   *   Whether the action was answered rather than denied.
   */
  private function act(string $path): bool {
    $request = $this->enterPath($path, 'island_test.page', 'POST');
    $request->request->replace([
      IslandActionSubscriber::ISLAND => 'action',
      IslandActionSubscriber::ACTION => 'delete',
      IslandActionSubscriber::HOST => self::HOST,
      IslandActionSubscriber::TOKEN => $this->container->get('csrf_token')->get(IslandActionSubscriber::tokenSeed('action', 'delete')),
    ]);
    $event = new RequestEvent($this->container->get('http_kernel'), $request, HttpKernelInterface::MAIN_REQUEST);
    try {
      $this->container->get('island.action_subscriber')->onRequest($event);
    }
    catch (AccessDeniedHttpException) {
      return FALSE;
    }
    finally {
      $this->container->get('request_stack')->pop();
    }
    return $event->getResponse()?->getStatusCode() === 200;
  }

}
