<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Core\Session\AnonymousUserSession;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\user\Entity\User;
use Drupal\user\UserInterface;
use Drupal\bb_api_key\Access\ApiKeyAccess;
use Drupal\bb_api_key\ApiKeyManager;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Owner-only route access, including admin non-bypass and legacy exclusion.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ApiKeyAccessTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'state_machine',
    'consumers', 'simple_oauth', 'views', 'bb_core', 'bb_api_key',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('consumer');
    $this->installConfig(['user', 'simple_oauth']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();
  }

  /**
   * Builds a route match test double for the given path parameters.
   */
  private function routeMatch(?UserInterface $user, ?ConsumerInterface $consumer = NULL): RouteMatchInterface {
    $route_match = $this->createMock(RouteMatchInterface::class);
    $route_match->method('getParameter')->willReturnMap([
      ['user', $user],
      ['consumer', $consumer],
    ]);
    return $route_match;
  }

  /**
   * The owner is allowed on their own personal route.
   */
  public function testOwnerIsAllowedOnOwnPersonalRoute(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $access = $this->container->get(ApiKeyAccess::class);
    $this->assertTrue($access->personal($this->routeMatch($owner), $owner)->isAllowed());
  }

  /**
   * Another authenticated user is denied.
   */
  public function testOtherAuthenticatedUserIsDenied(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $other = $this->createUser();
    self::assertInstanceOf(User::class, $other);
    $access = $this->container->get(ApiKeyAccess::class);
    $this->assertFalse($access->personal($this->routeMatch($owner), $other)->isAllowed());
  }

  /**
   * Admin status never substitutes for ownership.
   */
  public function testAdminStatusDoesNotBypassOwnership(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $admin = $this->createUser([], NULL, TRUE);
    self::assertInstanceOf(User::class, $admin);
    $access = $this->container->get(ApiKeyAccess::class);
    $this->assertFalse($access->personal($this->routeMatch($owner), $admin)->isAllowed());
  }

  /**
   * An anonymous visitor is denied.
   */
  public function testAnonymousIsDenied(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $access = $this->container->get(ApiKeyAccess::class);
    $anonymous = new AnonymousUserSession();
    $this->assertFalse($access->personal($this->routeMatch($owner), $anonymous)->isAllowed());
  }

  /**
   * Revoke is allowed only for the owner of a managed key.
   */
  public function testRevokeAllowedOnlyForOwnedManagedKey(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $other = $this->createUser();
    self::assertInstanceOf(User::class, $other);
    $manager = $this->container->get(ApiKeyManager::class);
    $time = $this->container->get('datetime.time');
    $issued = $manager->create($owner, 'Pipeline', $time->getCurrentTime() + 86400);
    $key = $issued['consumer'];

    $access = $this->container->get(ApiKeyAccess::class);
    $this->assertTrue($access->revoke($this->routeMatch($owner, $key), $owner)->isAllowed());
    $this->assertFalse($access->revoke($this->routeMatch($owner, $key), $other)->isAllowed());
  }

  /**
   * Revoke is denied for an ordinary, unmarked consumer.
   */
  public function testRevokeDeniedForLegacyUnmarkedConsumer(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $storage = $this->container->get('entity_type.manager')->getStorage('consumer');
    $legacy = $storage->create([
      'client_id' => 'bakers-legacy',
      'label' => 'Legacy',
      'secret' => 's',
      'user_id' => $owner->id(),
      'confidential' => TRUE,
      'grant_types' => ['client_credentials'],
    ]);
    self::assertInstanceOf(ConsumerInterface::class, $legacy);
    $legacy->save();

    $access = $this->container->get(ApiKeyAccess::class);
    $this->assertFalse($access->revoke($this->routeMatch($owner, $legacy), $owner)->isAllowed());
  }

}
