<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login_oauth\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\social_auth\Entity\SocialAuth;
use Drupal\user\Entity\User;

/**
 * Whether an account holds at least one social_auth link (BB-507 D1).
 *
 * @group bb_login_oauth
 */
final class IdentityLinkTest extends KernelTestBase {

  /**
   * The modules under test.
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
  }

  /**
   * A user with a social_auth link is reported as linked.
   */
  public function testLinkedAccountIsReportedAsLinked(): void {
    $linked = User::create(['name' => 'ada', 'mail' => 'ada@example.com', 'status' => 1]);
    $linked->save();
    SocialAuth::create([
      'user_id' => $linked->id(),
      'plugin_id' => 'social_auth_google',
      'provider_user_id' => 'google-1',
      'token' => 'token',
      'additional_data' => [],
    ])->save();

    $unlinked = User::create(['name' => 'bob', 'mail' => 'bob@example.com', 'status' => 1]);
    $unlinked->save();

    /** @var \Drupal\bb_login_oauth\IdentityLink $identity_link */
    $identity_link = $this->container->get('bb_login_oauth.identity_link');

    self::assertTrue($identity_link->isLinked((int) $linked->id()));
    self::assertFalse($identity_link->isLinked((int) $unlinked->id()));
  }

  /**
   * A deleted link record leaves an account unlinked again.
   */
  public function testDeletedLinkIsNoLongerReportedAsLinked(): void {
    $user = User::create(['name' => 'carol', 'mail' => 'carol@example.com', 'status' => 1]);
    $user->save();
    $social_auth = SocialAuth::create([
      'user_id' => $user->id(),
      'plugin_id' => 'social_auth_google',
      'provider_user_id' => 'google-2',
      'token' => 'token',
      'additional_data' => [],
    ]);
    $social_auth->save();

    /** @var \Drupal\bb_login_oauth\IdentityLink $identity_link */
    $identity_link = $this->container->get('bb_login_oauth.identity_link');
    self::assertTrue($identity_link->isLinked((int) $user->id()));

    $social_auth->delete();

    self::assertFalse($identity_link->isLinked((int) $user->id()));
  }

}
