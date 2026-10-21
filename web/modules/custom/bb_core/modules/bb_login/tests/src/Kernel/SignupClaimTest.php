<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\Component\Utility\Crypt;
use Drupal\bb_login\Controller\BbSignupClaimController;
use Drupal\KernelTests\KernelTestBase;
use Drupal\user\Entity\User;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Session\Session;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;

/**
 * Redeeming the mailed link's nonce creates the account, once and only once.
 *
 * @group bb_login
 */
final class SignupClaimTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'options', 'file', 'image', 'bb_core', 'bb_login'];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installConfig(['user', 'system']);
  }

  /**
   * Puts a request carrying a fresh session on the stack, and returns it.
   */
  private function pushRequest(): Request {
    $request = Request::create('/user/claim/x');
    $request->setSession(new Session(new MockArraySessionStorage()));
    $this->container->get('request_stack')->push($request);
    return $request;
  }

  /**
   * Redeeming the link creates the account and lands on home.
   */
  public function testRedeemingTheLinkCreatesTheAccountAndLandsOnHome(): void {
    /** @var \Drupal\bb_login\PendingSignup $pending */
    $pending = $this->container->get('bb_login.pending_signup');
    $nonce = $pending->issue('late@example.com');

    $request = $this->pushRequest();
    $controller = BbSignupClaimController::create($this->container);
    $response = $controller->claim($nonce, $request);

    $accounts = $this->container->get('entity_type.manager')
      ->getStorage('user')->loadByProperties(['mail' => 'late@example.com']);
    self::assertCount(1, $accounts, 'redeeming the link creates exactly one account');
    self::assertTrue((bool) $this->container->get('current_user')->isAuthenticated());
    self::assertStringContainsString('/home', $response->getTargetUrl());
  }

  /**
   * A spent nonce creates no second account and sends the visitor back.
   */
  public function testSpentNonceCreatesNoSecondAccount(): void {
    /** @var \Drupal\bb_login\PendingSignup $pending */
    $pending = $this->container->get('bb_login.pending_signup');
    $nonce = $pending->issue('twice@example.com');

    $request = $this->pushRequest();
    $controller = BbSignupClaimController::create($this->container);
    $controller->claim($nonce, $request);

    // The row is already consumed, so a second visit finds nothing to claim.
    $request2 = $this->pushRequest();
    $response = $controller->claim($nonce, $request2);

    self::assertCount(1, $this->container->get('entity_type.manager')
      ->getStorage('user')->loadByProperties(['mail' => 'twice@example.com']));
    self::assertStringContainsString('/user/login', $response->getTargetUrl());
  }

  /**
   * An invented or never-issued nonce is refused the same way as a spent one.
   */
  public function testAnInventedNonceIsRefused(): void {
    $request = $this->pushRequest();
    $controller = BbSignupClaimController::create($this->container);
    $response = $controller->claim(Crypt::randomBytesBase64(32), $request);

    self::assertStringContainsString('/user/login', $response->getTargetUrl());
  }

  /**
   * An account that appeared meanwhile is signed in rather than duplicated.
   */
  public function testAnAccountThatAppearedMeanwhileIsSignedInRatherThanDuplicated(): void {
    /** @var \Drupal\bb_login\PendingSignup $pending */
    $pending = $this->container->get('bb_login.pending_signup');
    $nonce = $pending->issue('race@example.com');

    // The Google door, or a second request redeemed first, got there first.
    User::create(['name' => 'race', 'mail' => 'race@example.com', 'status' => 1])->save();

    $request = $this->pushRequest();
    $controller = BbSignupClaimController::create($this->container);
    $response = $controller->claim($nonce, $request);

    self::assertCount(1, $this->container->get('entity_type.manager')
      ->getStorage('user')->loadByProperties(['mail' => 'race@example.com']));
    self::assertStringContainsString('/home', $response->getTargetUrl());
  }

  /**
   * An account blocked meanwhile is refused, not signed in.
   */
  public function testAnAccountBlockedMeanwhileIsRefusedRatherThanSignedIn(): void {
    /** @var \Drupal\bb_login\PendingSignup $pending */
    $pending = $this->container->get('bb_login.pending_signup');
    $nonce = $pending->issue('blocked@example.com');

    // Appeared through the Google door, or a second redemption, and was then
    // blocked — still within the nonce's twenty-four hours.
    User::create(['name' => 'blocked', 'mail' => 'blocked@example.com', 'status' => 0])->save();

    $request = $this->pushRequest();
    $controller = BbSignupClaimController::create($this->container);
    $response = $controller->claim($nonce, $request);

    self::assertFalse((bool) $this->container->get('current_user')->isAuthenticated());
    self::assertStringContainsString('/user/login', $response->getTargetUrl());
  }

}
