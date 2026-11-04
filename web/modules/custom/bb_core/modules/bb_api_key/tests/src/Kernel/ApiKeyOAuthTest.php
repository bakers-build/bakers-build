<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Kernel;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Authentication\AuthenticationProviderInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Url;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\simple_oauth\Functional\SimpleOauthTestTrait;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\consumers\Entity\Consumer;
use Drupal\user\Entity\User;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\bb_api_key\Authentication\ApiKeyAuthenticationProvider;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Exception\OAuthUnauthorizedHttpException;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\HttpFoundation\Request;

/**
 * Managed-key identity resolves to the exact owner, not the scope policy.
 *
 * `simple_oauth.repositories.client` decoration is covered unit-style in
 * ApiKeyClientRepositoryTest; this class covers the identity-conversion
 * decorator against real service wiring, plus the deletion/token-revocation
 * integration already exercised end-to-end in ApiKeyStorageTest.
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
#[RunTestsInSeparateProcesses]
final class ApiKeyOAuthTest extends KernelTestBase {

  use UserCreationTrait;
  use SimpleOauthTestTrait;

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
    $this->installEntitySchema('oauth2_token');
    // BbRankCapability's hasPermission() hook queries bb_workspace even
    // for an account with no memberships at all.
    $this->installEntitySchema('bb_workspace');
    $this->installConfig(['user', 'simple_oauth']);
    $this->container->get('entity_type.manager')->getStorage('oauth2_scope')->create([
      'id' => 'bb_session',
      'name' => 'bb:session',
      'grant_types' => ['client_credentials' => ['status' => TRUE]],
      'umbrella' => TRUE,
    ])->save();
  }

  /**
   * Generates real RSA keys and points simple_oauth at them.
   *
   * Required to mint a genuine, verifiable access token through a real HTTP
   * round trip to `/oauth/token` rather than a mocked inner provider.
   */
  private function enableRealTokenSigning(): void {
    mkdir($this->siteDirectory . '/keys', 0775, TRUE);
    $public = $this->siteDirectory . '/keys/public.key';
    $private = $this->siteDirectory . '/keys/private.key';
    file_put_contents($public, $this->publicKey);
    file_put_contents($private, $this->privateKey);
    chmod($public, 0660);
    chmod($private, 0660);
    $this->config('simple_oauth.settings')
      ->set('public_key', $public)
      ->set('private_key', $private)
      ->save();
  }

  /**
   * Mints a real access token for a consumer through a real HTTP POST.
   */
  private function mintRealAccessToken(string $clientId, string $secret): string {
    $request = Request::create(Url::fromRoute('oauth2_token.token')->toString(), 'POST', [
      'grant_type' => 'client_credentials',
      'client_id' => $clientId,
      'client_secret' => $secret,
    ]);
    $response = $this->container->get('http_kernel')->handle($request);
    self::assertSame(200, $response->getStatusCode(), (string) $response->getContent());
    $decoded = Json::decode((string) $response->getContent());
    self::assertIsString($decoded['access_token'] ?? NULL);
    return $decoded['access_token'];
  }

  /**
   * Authenticates a Bearer token through the REAL, undecorated-inner chain.
   *
   * `simple_oauth.authentication.simple_oauth` is the service id this
   * module's provider decorates, so fetching it from the container returns
   * the exact chain a real request goes through: the shipped inner
   * `Oauth2Authentication` provider plus this module's conversion — no mock.
   */
  private function authenticateBearer(string $token): ?AccountInterface {
    $request = Request::create('/jsonapi');
    $request->headers->set('Authorization', 'Bearer ' . $token);
    $provider = $this->container->get('simple_oauth.authentication.simple_oauth');
    self::assertInstanceOf(ApiKeyAuthenticationProvider::class, $provider);
    return $provider->authenticate($request);
  }

  /**
   * The decorator around a stubbed inner provider, with real collaborators.
   */
  private function provider(AuthenticationProviderInterface $inner): ApiKeyAuthenticationProvider {
    return new ApiKeyAuthenticationProvider(
      $inner,
      $this->container->get(ApiKeyManager::class),
      $this->container->get('simple_oauth.repositories.client'),
      $this->container->get('entity_type.manager'),
    );
  }

  /**
   * A valid managed token's identity converts to the exact owner account.
   */
  public function testManagedTokenConvertsToOwnerSubject(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $manager = $this->container->get(ApiKeyManager::class);
    $time = $this->container->get('datetime.time');
    $issued = $manager->create($owner, 'Pipeline', $time->getCurrentTime() + 86400);

    $tokenUser = $this->createMock(TokenAuthUserInterface::class);
    $tokenUser->method('getConsumer')->willReturn($issued['consumer']);
    $tokenUser->method('getSubject')->willReturn($owner);

    $inner = $this->createMock(AuthenticationProviderInterface::class);
    $inner->method('authenticate')->willReturn($tokenUser);

    $provider = $this->provider($inner);
    $account = $provider->authenticate(Request::create('/oauth/token'));

    $this->assertInstanceOf(AccountInterface::class, $account);
    $this->assertNotInstanceOf(TokenAuthUserInterface::class, $account);
    $this->assertSame((int) $owner->id(), (int) $account->id());
  }

  /**
   * An ordinary (non-managed) token's identity passes through unchanged.
   */
  public function testOrdinaryTokenPassesThroughUnchanged(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $storage = $this->container->get('entity_type.manager')->getStorage('consumer');
    $legacy = $storage->create([
      'client_id' => 'bakers-cw',
      'label' => 'Legacy',
      'secret' => 's',
      'user_id' => $owner->id(),
      'confidential' => TRUE,
      'grant_types' => ['client_credentials'],
    ]);
    $legacy->save();

    $tokenUser = $this->createMock(TokenAuthUserInterface::class);
    $tokenUser->method('getConsumer')->willReturn($legacy);

    $inner = $this->createMock(AuthenticationProviderInterface::class);
    $inner->method('authenticate')->willReturn($tokenUser);

    $provider = $this->provider($inner);
    $account = $provider->authenticate(Request::create('/oauth/token'));

    $this->assertSame($tokenUser, $account);
  }

  /**
   * A managed key whose owner diverges from the account rejects, not grants.
   */
  public function testDivergedOwnerIsRejected(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $stranger = $this->createUser();
    self::assertInstanceOf(User::class, $stranger);
    $manager = $this->container->get(ApiKeyManager::class);
    $time = $this->container->get('datetime.time');
    $issued = $manager->create($owner, 'Pipeline', $time->getCurrentTime() + 86400);

    $tokenUser = $this->createMock(TokenAuthUserInterface::class);
    $tokenUser->method('getConsumer')->willReturn($issued['consumer']);
    // Simulate a subject resolved to someone other than the key's owner.
    $tokenUser->method('getSubject')->willReturn($stranger);

    $inner = $this->createMock(AuthenticationProviderInterface::class);
    $inner->method('authenticate')->willReturn($tokenUser);

    $provider = $this->provider($inner);

    $this->expectException(OAuthUnauthorizedHttpException::class);
    $provider->authenticate(Request::create('/oauth/token'));
  }

  /**
   * An orphan token resolves to a clean 401 through the real auth chain.
   */
  public function testOrphanTokenRejectsWithTypedUnauthorized(): void {
    $this->enableRealTokenSigning();
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $time = $this->container->get('datetime.time');
    $manager = $this->container->get(ApiKeyManager::class);
    $issued = $manager->create($owner, 'Pipeline', $time->getCurrentTime() + 86400);

    $token = $this->mintRealAccessToken(
      (string) $issued['consumer']->get('client_id')->value,
      $issued['secret'],
    );

    // Orphan the token: its consumer row vanishes while the token row stays
    // — a raw delete, bypassing ApiKeyHooks::entityDelete(), which would
    // otherwise clean up the token through the ordinary entity-delete path
    // this scenario exists to NOT go through. `TokenAuthUser::__construct()`
    // assigns the (now NULL) client entity to its non-nullable `Consumer
    // $consumer` property, which is the exact TypeError this decorator must
    // translate into a clean 401.
    $cid = (int) $issued['consumer']->id();
    $database = $this->container->get('database');
    $database->delete('consumer')->condition('id', $cid)->execute();
    $database->delete('consumer_field_data')->condition('id', $cid)->execute();
    $this->container->get('entity_type.manager')->getStorage('consumer')->resetCache([$cid]);

    try {
      $this->authenticateBearer($token);
      self::fail('expected an OAuthUnauthorizedHttpException');
    }
    catch (OAuthUnauthorizedHttpException $exception) {
      self::assertStringContainsString('invalid_token', $exception->getHeaders()['WWW-Authenticate'] ?? '');
    }
  }

  /**
   * Non-OAuth authentication (cookie sessions etc.) is never touched.
   */
  public function testNonTokenAccountPassesThroughUnchanged(): void {
    $owner = $this->createUser();
    self::assertInstanceOf(User::class, $owner);
    $inner = $this->createMock(AuthenticationProviderInterface::class);
    $inner->method('authenticate')->willReturn($owner);

    $provider = $this->provider($inner);
    $account = $provider->authenticate(Request::create('/'));

    $this->assertSame($owner, $account);
  }

  /**
   * A real managed-key token carries exactly the owner's permissions.
   *
   * Including a permission the `bb_session` scope itself grants nobody,
   * while a plain scope-only consumer for the same user gets none of it, and
   * a live role change is reflected on the very next request without minting
   * a new token.
   *
   * This goes through the REAL authentication chain
   * (`simple_oauth.authentication.simple_oauth`, which this module decorates
   * in bb_api_key.services.yml) and a REAL, HTTP-minted access token — no
   * mocked inner provider. Disabling the conversion in
   * ApiKeyAuthenticationProvider::authenticate() (returning $account
   * unconditionally) was manually verified to fail this test's first
   * assertion before this change shipped.
   */
  public function testRealManagedTokenCarriesExactlyOwnerPermissions(): void {
    $this->enableRealTokenSigning();
    $permission = 'access administration pages';
    // Uid 1 is Drupal's superuser and bypasses permission checks entirely,
    // even wrapped in a TokenAuthUser (BbRankCapability::isInstanceAdmin());
    // a throwaway user keeps the owner off uid 1.
    $this->createUser();
    $owner = $this->createUser([$permission]);
    self::assertInstanceOf(User::class, $owner);
    $time = $this->container->get('datetime.time');
    $manager = $this->container->get(ApiKeyManager::class);

    // The managed key: its token must resolve to the owner's real account.
    $issued = $manager->create($owner, 'Pipeline', $time->getCurrentTime() + 86400);
    $managedToken = $this->mintRealAccessToken(
      (string) $issued['consumer']->get('client_id')->value,
      $issued['secret'],
    );
    $account = $this->authenticateBearer($managedToken);
    self::assertInstanceOf(AccountInterface::class, $account);
    self::assertNotInstanceOf(TokenAuthUserInterface::class, $account);
    self::assertSame((int) $owner->id(), (int) $account->id());
    self::assertTrue(
      $account->hasPermission($permission),
      'a managed key must carry the exact owner permission, not the (empty) bb_session scope ceiling',
    );

    // Control: an ordinary, non-managed client_credentials consumer for the
    // SAME user, on the SAME scope, must NOT pick up that permission — it is
    // left on the scope-only identity Oauth2AccessPolicy builds.
    $plain = Consumer::create([
      'client_id' => 'plain-control',
      'label' => 'Plain control',
      'secret' => 'a-secret-long-enough',
      'user_id' => $owner->id(),
      'confidential' => TRUE,
      'grant_types' => ['client_credentials'],
      'scopes' => [['scope_id' => 'bb_session']],
    ]);
    $plain->save();
    $plainToken = $this->mintRealAccessToken('plain-control', 'a-secret-long-enough');
    $controlAccount = $this->authenticateBearer($plainToken);
    self::assertInstanceOf(AccountInterface::class, $controlAccount);
    self::assertFalse(
      $controlAccount->hasPermission($permission),
      'a plain (non-managed) consumer must not get the owner permission conversion',
    );

    // Live role change: the SAME managed token, re-authenticated after the
    // permission is revoked from the owner's role, must stop granting it.
    foreach ($owner->getRoles(TRUE) as $rid) {
      user_role_revoke_permissions($rid, [$permission]);
    }
    $accountAfterRevoke = $this->authenticateBearer($managedToken);
    self::assertInstanceOf(AccountInterface::class, $accountAfterRevoke);
    self::assertFalse(
      $accountAfterRevoke->hasPermission($permission),
      'a role change on the owner must be visible on the very next authenticated request',
    );
  }

}
