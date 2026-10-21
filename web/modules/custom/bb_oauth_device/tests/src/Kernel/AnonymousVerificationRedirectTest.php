<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_oauth_device\Kernel;

use Drupal\Component\Serialization\Yaml;
use Drupal\KernelTests\Core\Entity\EntityKernelTestBase;
use Drupal\user\Entity\User;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * An anonymous visitor on the device page is sent to the login form.
 *
 * Runs against the SHIPPED r4032login settings from `config/sync`: their
 * `/oauth/*` exclusion is what turned this page into a bare 403, and the e2e
 * recipe replaces that list, so no browser test can see the difference.
 */
#[Group('bb_oauth_device')]
#[RunTestsInSeparateProcesses]
class AnonymousVerificationRedirectTest extends EntityKernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'file',
    'image',
    'options',
    'serialization',
    'consumers',
    'simple_oauth',
    'r4032login',
    'bb_oauth_device',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->installEntitySchema('consumer');
    $this->installEntitySchema('oauth2_token');
    $this->installConfig(['user', 'simple_oauth', 'r4032login']);
    // The verification page renders bb_theme components.
    $this->container->get('theme_installer')->install(['bb_theme']);
    $this->config('system.theme')->set('default', 'bb_theme')->save();

    $shipped = Yaml::decode((string) file_get_contents(DRUPAL_ROOT . '/../config/sync/r4032login.settings.yml'));
    unset($shipped['_core']);
    $this->config('r4032login.settings')->setData($shipped)->save();
  }

  /**
   * The device link, with and without its code, and with a stray destination.
   */
  public static function deviceLinks(): array {
    return [
      'with user code' => [['user_code' => 'TEST-CODE'], '/oauth/device?user_code=TEST-CODE'],
      'without user code' => [[], '/oauth/device'],
      'with a smuggled destination' => [
        ['user_code' => 'TEST-CODE', 'destination' => '/foo'],
        '/oauth/device?user_code=TEST-CODE',
      ],
    ];
  }

  /**
   * Anonymous visitors land on the login form, keeping the device link.
   */
  #[DataProvider('deviceLinks')]
  public function testAnonymousVisitorIsRedirectedToLogin(array $query, string $destination): void {
    $response = $this->handle(Request::create('/oauth/device', 'GET', $query));

    $this->assertSame(302, $response->getStatusCode());
    $location = (string) $response->headers->get('Location');
    $this->assertSame('/user/login', parse_url($location, PHP_URL_PATH));
    parse_str((string) parse_url($location, PHP_URL_QUERY), $location_query);
    $this->assertSame($destination, $location_query['destination'] ?? NULL);
  }

  /**
   * Machine endpoints under /oauth keep their own answers.
   */
  public function testMachineEndpointsAreNotRedirected(): void {
    $requests = [
      Request::create('/oauth/token', 'POST', ['grant_type' => 'password']),
      Request::create('/oauth/device_authorization', 'POST', ['client_id' => 'unknown']),
      Request::create('/oauth/authorize'),
    ];
    foreach ($requests as $request) {
      $response = $this->handle($request);
      $this->assertNotSame(302, $response->getStatusCode(), $request->getPathInfo());
      $this->assertFalse($response->headers->has('Location'), $request->getPathInfo());
    }
  }

  /**
   * Access-checked machine endpoints keep answering 403, not a login redirect.
   */
  public function testDeniedMachineEndpointsStayForbidden(): void {
    foreach (['/oauth/userinfo', '/oauth/debug'] as $path) {
      $response = $this->handle(Request::create($path));
      $this->assertSame(403, $response->getStatusCode(), $path);
      $this->assertFalse($response->headers->has('Location'), $path);
    }
  }

  /**
   * A signed-in account without the permission still gets a 403.
   */
  public function testSignedInAccountWithoutPermissionStaysForbidden(): void {
    // Uid 1 bypasses permission checks; spend it on a throwaway account.
    $this->drupalCreateUser([]);
    $account = $this->drupalCreateUser([]);
    $this->assertInstanceOf(User::class, $account);
    $this->setCurrentUser($account);

    $response = $this->handle(Request::create('/oauth/device', 'GET', ['user_code' => 'TEST-CODE']));

    $this->assertSame(403, $response->getStatusCode());
    $this->assertFalse($response->headers->has('Location'));
  }

  /**
   * A signed-in member sees the confirmation form, not a redirect.
   */
  public function testSignedInMemberSeesTheForm(): void {
    // Uid 1 bypasses permission checks; spend it on a throwaway account.
    $this->drupalCreateUser([]);
    $member = $this->drupalCreateUser(['grant simple_oauth codes']);
    $this->assertInstanceOf(User::class, $member);
    $this->setCurrentUser($member);

    $response = $this->handle(Request::create('/oauth/device', 'GET', ['user_code' => 'TEST-CODE']));

    $this->assertSame(200, $response->getStatusCode());
    $this->assertStringContainsString('TEST-CODE', (string) $response->getContent());
  }

  /**
   * Handles a request through the in-process HTTP kernel.
   */
  protected function handle(Request $request): Response {
    return $this->container->get('http_kernel')->handle($request);
  }

}
