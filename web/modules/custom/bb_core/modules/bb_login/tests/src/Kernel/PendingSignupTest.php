<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_login\Kernel;

use Drupal\KernelTests\KernelTestBase;

/**
 * The pending sign-up store's contract.
 *
 * @group bb_login
 */
final class PendingSignupTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<int, string>
   */
  protected static $modules = ['system', 'user', 'file', 'image', 'bb_core', 'bb_login'];

  /**
   * A nonce round-trips once and only once.
   */
  public function testNonceRoundTripsOnceAndOnlyOnce(): void {
    /** @var \Drupal\bb_login\PendingSignup $pending */
    $pending = $this->container->get('bb_login.pending_signup');
    $nonce = $pending->issue('ada@example.com');

    self::assertNotSame('', $nonce);
    self::assertSame('ada@example.com', $pending->claim($nonce));
    // Consumed: a second redemption of one mail must not hand out a second
    // account.
    self::assertNull($pending->claim($nonce));
    self::assertNull($pending->claim('never-issued'));
  }

  /**
   * Two requests for one address leave two independently redeemable rows.
   */
  public function testTwoRequestsForOneAddressAreIndependent(): void {
    /** @var \Drupal\bb_login\PendingSignup $pending */
    $pending = $this->container->get('bb_login.pending_signup');
    $first = $pending->issue('ada@example.com');
    $second = $pending->issue('ada@example.com');

    self::assertNotSame($first, $second);
    // Asking twice must not invalidate the mail already in the inbox.
    self::assertSame('ada@example.com', $pending->claim($first));
    self::assertSame('ada@example.com', $pending->claim($second));
  }

}
