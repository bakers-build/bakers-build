<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\user\Entity\User;
use Drupal\user\UserAuthenticationInterface;
use Drupal\user\UserAuthInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * A service account cannot establish or use an interactive session.
 *
 * Three shared boundaries, each with a human control: `user.auth` (behind
 * core's password form and `basic_auth`) never finds a service account; the
 * cookie authentication provider never serves a request as one, whatever
 * path created its session; and `user_login_finalize()` — which the
 * one-time-login/claim controllers and `social_auth`'s `UserAuthenticator`
 * (behind `VerifiedEmailAuthenticator` and `IdentityLink`) all end in —
 * refuses to finalize one.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ServiceAccountLoginTest extends KernelTestBase {

  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'serialization', 'options', 'image', 'file',
    'text', 'link', 'filter', 'markdown_easy', 'field', 'state_machine', 'entity', 'og',
    'consumers', 'simple_oauth', 'views', 'bb_core', 'bb_api_key',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('bb_workspace');
    $this->installEntitySchema('consumer');
    $this->installConfig(['system', 'user']);
  }

  /**
   * Creates an active service account bound to a fresh workspace.
   */
  private function createServiceAccount(): UserInterface {
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')->create([
      'name' => 'Acme',
      'slug' => 'acme',
    ]);
    self::assertInstanceOf(BbWorkspaceInterface::class, $workspace);
    $workspace->save();

    $service = User::create([
      'name' => 'service-ci-aaaaaaaa',
      'status' => 1,
      'bb_service_workspace' => $workspace->id(),
    ]);
    self::assertInstanceOf(UserInterface::class, $service);
    $service->save();
    return $service;
  }

  /**
   * Authenticates a request carrying a session for the given user ID.
   */
  private function cookieAccountFor(int $uid): mixed {
    $session = new Session(new MockArraySessionStorage());
    $session->set('uid', $uid);
    $request = Request::create('/');
    $request->setSession($session);
    return $this->container->get('user.authentication.cookie')->authenticate($request);
  }

  /**
   * Password and basic-auth credential lookup never finds a service account.
   */
  public function testPasswordAuthenticationRefusesServiceAccount(): void {
    // Presave forbids a password on a service account; plant one out of band
    // so the boundary is proven independently of that invariant.
    $service = $this->createServiceAccount();
    $this->container->get('database')->update('users_field_data')
      ->fields(['pass' => $this->container->get('password')->hash('correct-horse-battery')])
      ->condition('uid', $service->id())
      ->execute();
    $this->container->get('entity_type.manager')->getStorage('user')->resetCache([$service->id()]);
    $service = User::load($service->id());
    self::assertInstanceOf(UserInterface::class, $service);
    $human = $this->createUser([], 'human-control', FALSE, ['pass' => 'correct-horse-battery']);
    self::assertInstanceOf(UserInterface::class, $human);
    $auth = $this->container->get('user.auth');
    self::assertInstanceOf(UserAuthInterface::class, $auth);
    self::assertInstanceOf(UserAuthenticationInterface::class, $auth);

    self::assertFalse($auth->authenticate($service->getAccountName(), 'correct-horse-battery'));
    self::assertFalse($auth->lookupAccount($service->getAccountName()));
    self::assertFalse($auth->authenticateAccount($service, 'correct-horse-battery'));

    self::assertSame((int) $human->id(), (int) $auth->authenticate('human-control', 'correct-horse-battery'));
    $found = $auth->lookupAccount('human-control');
    self::assertInstanceOf(UserInterface::class, $found);
    self::assertTrue($auth->authenticateAccount($found, 'correct-horse-battery'));
  }

  /**
   * A session for a service account is never served as that identity.
   */
  public function testCookieSessionNeverAuthenticatesServiceAccount(): void {
    $service = $this->createServiceAccount();
    $human = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $human);

    self::assertNull($this->cookieAccountFor((int) $service->id()), 'a service-account session must be anonymous');
    $account = $this->cookieAccountFor((int) $human->id());
    self::assertNotNull($account);
    self::assertSame((int) $human->id(), (int) $account->id());
  }

  /**
   * The core login finalizer refuses a service account and ends the session.
   */
  public function testServiceAccountCannotFinalizeInteractiveLogin(): void {
    $service = $this->createServiceAccount();

    $this->expectException(AccessDeniedHttpException::class);
    try {
      user_login_finalize($service);
    }
    finally {
      $this->assertTrue($this->container->get('current_user')->isAnonymous(), 'the session must not carry the service identity, success or failure');
    }
  }

  /**
   * A human account finalizes an interactive login exactly as before.
   */
  public function testHumanLoginIsUnaffected(): void {
    $human = $this->createUser();
    self::assertInstanceOf(UserInterface::class, $human);

    user_login_finalize($human);

    $this->assertSame((int) $human->id(), (int) $this->container->get('current_user')->id());
  }

}
