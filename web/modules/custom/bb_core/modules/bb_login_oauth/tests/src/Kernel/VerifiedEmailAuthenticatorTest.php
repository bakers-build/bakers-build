<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login_oauth\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\bb_login_oauth\BbGoogleAuthManager;
use Drupal\social_auth\User\SocialAuthUser;
use Drupal\user\Entity\User;

/**
 * The three-way decision that keeps an unverified address off an account.
 *
 * DRIVES `authenticateUser()`, never `authenticateWithEmail()` directly —
 * calling `authenticateWithEmail()` with a hand-built `$data` array is what
 * let this suite go green while `BbGoogleAuthManager::getUserInfo()` wrote
 * the assertion where `authenticateUser()`'s `getAdditionalData()` forward
 * could never read it (BB-476 review finding 2). Building a
 * `SocialAuthUser` and calling `authenticateUser()` is the same entry point
 * `OAuth2ControllerBase` uses on the real Google flow.
 *
 * @group bb_login_oauth
 */
final class VerifiedEmailAuthenticatorTest extends KernelTestBase {

  /**
   * The modules under test.
   *
   * `options` provides `list_string`, which a `bb_core` route rebuild needs.
   *
   * @var array<int, string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'file', 'image', 'bb_core', 'bb_login',
    'social_api', 'social_auth', 'social_auth_google', 'bb_login_oauth',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('social_auth');
    $this->installConfig(['user', 'social_auth']);
    // MATCHES THE SITE'S `user.settings.register: admin_only`
    // (`config/sync/user.settings.yml`), not core's shipped `visitors`
    // default that `installConfig()` applies here. The decorator's whole
    // fail-closed design (BB-476 D5) depends on `isRegistrationDisabled()`
    // being TRUE — with the core default a refused `authenticateWithEmail()`
    // falls through to `social_auth`'s own, ungated `createNewUser()` instead
    // of being refused, which is a test-fixture gap rather than the
    // production behaviour.
    $this->config('user.settings')->set('register', 'admin_only')->save();
    // RESERVES UID 1. `installEntitySchema()` does not create the root
    // account an install profile normally would, so the fixture user below
    // would otherwise become uid 1 — and `social_auth` refuses uid 1 by
    // `disable_admin_login` default, which is a fixture defect, not the
    // security gate under test.
    User::create(['name' => 'root', 'mail' => 'root@example.com', 'status' => 1])->save();
  }

  /**
   * A confirmed, already-known address matches the existing account.
   */
  public function testVerifiedAddressMatchesTheExistingAccount(): void {
    $existing = User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1]);
    $existing->save();
    $before = count(User::loadMultiple());

    $authenticator = $this->container->get('social_auth.user_authenticator');
    $authenticator->setPluginId('social_auth_google');
    $authenticator->authenticateUser(new SocialAuthUser(
      'Ada', 'google-1', 'token', 'ada@example.com', NULL,
      [BbGoogleAuthManager::VERIFIED_KEY => TRUE],
    ));

    self::assertTrue(\Drupal::currentUser()->isAuthenticated());
    self::assertCount($before, User::loadMultiple(), 'no account was created for a match');
  }

  /**
   * An unconfirmed address never matches, even one an account already holds.
   */
  public function testUnverifiedAddressNeverReachesAnExistingAccount(): void {
    $existing = User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1]);
    $existing->save();

    $before = count(User::loadMultiple());

    $authenticator = $this->container->get('social_auth.user_authenticator');
    $authenticator->setPluginId('social_auth_google');
    $authenticator->authenticateUser(new SocialAuthUser(
      'Attacker', 'google-attacker', 'token', 'ada@example.com', NULL,
      [BbGoogleAuthManager::VERIFIED_KEY => FALSE],
    ));

    self::assertFalse(\Drupal::currentUser()->isAuthenticated());
    self::assertCount($before, User::loadMultiple(), 'no second account was created either');
  }

  /**
   * A provider that never collects the assertion fails closed too.
   */
  public function testMissingAssertionIsTreatedAsUnverified(): void {
    $existing = User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1]);
    $existing->save();

    $authenticator = $this->container->get('social_auth.user_authenticator');
    $authenticator->setPluginId('social_auth_google');
    $authenticator->authenticateUser(new SocialAuthUser('Ada', 'google-2', 'token', 'ada@example.com', NULL, []));

    self::assertFalse(\Drupal::currentUser()->isAuthenticated());
  }

  /**
   * The plugin definition resolves to bakers.build's auth manager, not contrib's.
   *
   * The prior round's fix (routing the claim into `additionalData`) still
   * left the network plugin's `auth_manager` pointed at contrib's
   * `GoogleAuthManager`, because the alternative — a colliding `@Network`
   * plugin id — silently loses Drupal's plugin discovery to module load
   * order. `hook_social_api_network_info_alter()` is the seam `social_api`
   * actually declares for this substitution, and this is the test that
   * would have caught the collision (BB-476 review, second round,
   * finding 2).
   */
  public function testTheResolvedDefinitionNamesBbsAuthManager(): void {
    $definition = \Drupal::service('plugin.network.manager')->getDefinition('social_auth_google');
    self::assertSame('\Drupal\bb_login_oauth\BbGoogleAuthManager', $definition['auth_manager']);
  }

  /**
   * A confirmed, unknown address gets exactly one new account.
   */
  public function testVerifiedUnknownAddressCreatesOneAccount(): void {
    $authenticator = $this->container->get('social_auth.user_authenticator');
    $authenticator->setPluginId('social_auth_google');
    $authenticator->authenticateUser(new SocialAuthUser(
      'Grace', 'google-3', 'token', 'grace@example.com', NULL,
      [BbGoogleAuthManager::VERIFIED_KEY => TRUE],
    ));

    self::assertTrue(\Drupal::currentUser()->isAuthenticated());
    $created = user_load_by_mail('grace@example.com');
    self::assertNotFalse($created);
    self::assertSame('grace', $created->getAccountName());
    self::assertTrue($created->isActive());
    self::assertNull($created->getPassword());
  }

}
