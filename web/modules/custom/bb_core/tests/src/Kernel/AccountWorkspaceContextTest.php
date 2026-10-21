<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Routing\RouteObjectInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Navigation\AccountWorkspaceContext;
use Drupal\og\OgMembershipInterface;
use Drupal\user\UserInterface;
use Drupal\views\Entity\View;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Account navigation accepts only an accessible, explicit workspace origin.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class AccountWorkspaceContextTest extends KernelTestBase {

  use UserCreationTrait;
  use OgScopeFixtureTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'field', 'file', 'image', 'options', 'entity',
    'state_machine', 'link', 'text', 'filter', 'markdown_easy', 'og',
    'ui_patterns', 'bb_core', 'views',
  ];

  /**
   * The ordinary workspace member.
   */
  private UserInterface $member;
  /**
   * The explicit origin workspace.
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
    $member = $this->createUser([], 'member');
    self::assertInstanceOf(UserInterface::class, $member);
    $this->member = $member;
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->create(['name' => 'Origin', 'slug' => 'origin', 'owner_user_id' => 1]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $this->workspace = $workspace;
    $this->workspace->save();
    $this->addMembership($this->workspace, $this->member);
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
    $this->container->get('account_switcher')->switchTo($this->member);
  }

  /**
   * Explicit context survives profile routes; invalid context never falls back.
   */
  public function testOriginAndFallback(): void {
    self::assertTrue($this->container->has(AccountWorkspaceContext::class));
    foreach (['entity.user.canonical', 'entity.user.edit_form'] as $route) {
      $this->enter($route, $this->workspace->uuid());
      $cache = new CacheableMetadata();
      self::assertSame($this->workspace->id(), $this->resolve($cache)?->id());
      self::assertContains('bb_workspace:' . $this->workspace->id(), $cache->getCacheTags());
      foreach ([
        NULL, '', 'bad', ['uuid' => $this->workspace->uuid()],
        'https://example.com', '00000000-0000-4000-8000-000000000001',
      ] as $invalid) {
        $this->enter($route, $invalid);
        $cache = new CacheableMetadata();
        self::assertNull($this->resolve($cache));
        foreach (['route', 'user', 'user.permissions', 'url.query_args:workspace'] as $context) {
          self::assertContains($context, $cache->getCacheContexts());
        }
        foreach (['bb_workspace_list', 'og_membership_list'] as $tag) {
          self::assertContains($tag, $cache->getCacheTags());
        }
      }
    }
    $this->enter('entity.user.canonical', $this->workspace->uuid(), 1);
    self::assertNull($this->resolve(new CacheableMetadata()));
    $this->enter('view.tickets.my_work', 'bad');
    $this->container->get('request_stack')->getCurrentRequest()->attributes->set('bb_workspace', $this->workspace);
    $this->container->get('current_route_match')->resetRouteMatch();
    self::assertSame($this->workspace->id(), $this->resolve(new CacheableMetadata())?->id());
  }

  /**
   * Membership alone is insufficient when the destination route denies access.
   */
  public function testDestinationAccessIsRequired(): void {
    $view = View::load('tickets');
    self::assertNotNull($view);
    $displays = $view->get('display');
    $displays['default']['display_options']['access'] = [
      'type' => 'perm',
      'options' => ['perm' => 'administer users'],
    ];
    $view->set('display', $displays)->save();
    $this->container->get('router.builder')->rebuild();
    $this->enter('entity.user.canonical', $this->workspace->uuid());
    $cache = new CacheableMetadata();
    self::assertNull($this->resolve($cache));
    self::assertContains('user.permissions', $cache->getCacheContexts());
  }

  /**
   * Back to workspace resolves on the own profile, not a foreign one.
   *
   * The shipped `bb_core.account.back_to_workspace` link, over the route
   * this class's fixture serves.
   */
  public function testBackToWorkspaceLinkFollowsTheValidatedOrigin(): void {
    // A fresh instance per case: the link memoises its workspace.
    $link = fn () => $this->container->get('plugin.manager.menu.link')
      ->createInstance('bb_core.account.back_to_workspace');

    $this->enter('entity.user.canonical', $this->workspace->uuid());
    self::assertSame(
      '/' . $this->workspace->getSlug() . '/tickets',
      $link()->getUrlObject()->toString(),
      'A valid origin on the own profile resolves to that workspace.',
    );

    $this->enter('entity.user.canonical', 'bad');
    self::assertSame(
      'route:<nolink>',
      $link()->getUrlObject()->toUriString(),
      'A malformed origin never falls back to a default workspace.',
    );

    $this->enter('entity.user.canonical', $this->workspace->uuid(), 1);
    self::assertSame(
      'route:<nolink>',
      $link()->getUrlObject()->toUriString(),
      'A valid origin on a FOREIGN profile is not the viewer\'s own "back".',
    );
  }

  /**
   * Revocation and deletion invalidate an origin that was previously accepted.
   */
  public function testRevokedAndDeletedContext(): void {
    self::assertTrue($this->container->has(AccountWorkspaceContext::class));
    $this->enter('entity.user.canonical', $this->workspace->uuid());
    self::assertNotNull($this->resolve(new CacheableMetadata()));
    $membership = $this->addMembership($this->workspace, $this->member);
    $membership->setState(OgMembershipInterface::STATE_BLOCKED)->save();
    self::assertNull($this->resolve(new CacheableMetadata()));
    $this->addMembership($this->workspace, $this->member);
    self::assertNotNull($this->resolve(new CacheableMetadata()));
    $this->workspace->delete();
    self::assertNull($this->resolve(new CacheableMetadata()));
  }

  /**
   * Resolves using the production service and mutable cache metadata.
   */
  private function resolve(CacheableMetadata $cache): ?BbWorkspaceInterface {
    return $this->container->get(AccountWorkspaceContext::class)->resolve($cache);
  }

  /**
   * Enters an actual account route with untrusted query data.
   */
  private function enter(string $route, mixed $value, ?int $uid = NULL): void {
    $request = Request::create('/user/' . ($uid ?? $this->member->id()), 'GET', $value === NULL ? [] : ['workspace' => $value]);
    $current = $this->container->get('request_stack')->getCurrentRequest();
    if ($current?->hasSession()) {
      $request->setSession($current->getSession());
    }
    $request->attributes->set(RouteObjectInterface::ROUTE_NAME, $route);
    $request->attributes->set(RouteObjectInterface::ROUTE_OBJECT, $this->container->get('router.route_provider')->getRouteByName($route));
    $request->attributes->set('user', $this->container->get('entity_type.manager')->getStorage('user')->load($uid ?? $this->member->id()));
    $this->container->get('request_stack')->push($request);
    $this->container->get('current_route_match')->resetRouteMatch();
  }

}
