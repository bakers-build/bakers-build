<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\bb_core\Deploy\OauthConsumerSecret;
use Drupal\Tests\UnitTestCase;

/**
 * @coversDefaultClass \Drupal\bb_core\Deploy\OauthConsumerSecret
 *
 * @group bb_core
 */
final class OauthConsumerSecretTest extends UnitTestCase {

  /**
   * An already-existing consumer is never touched, whatever the env carries.
   *
   * @covers ::decide
   */
  public function testExistingConsumerIsSkippedRegardlessOfIncoming(): void {
    self::assertSame(
      OauthConsumerSecret::SKIP_EXISTING,
      OauthConsumerSecret::decide(TRUE, 'anything'),
    );
    self::assertSame(
      OauthConsumerSecret::SKIP_EXISTING,
      OauthConsumerSecret::decide(TRUE, ''),
    );
  }

  /**
   * A missing consumer with a secret in the env is created (one-time seed).
   *
   * @covers ::decide
   */
  public function testMissingConsumerWithSecretIsCreated(): void {
    self::assertSame(
      OauthConsumerSecret::CREATE,
      OauthConsumerSecret::decide(FALSE, 'fresh'),
    );
  }

  /**
   * A missing consumer with no secret cannot be seeded — skip and warn.
   *
   * @covers ::decide
   */
  public function testMissingConsumerWithoutSecretIsSkipped(): void {
    self::assertSame(
      OauthConsumerSecret::SKIP_EMPTY,
      OauthConsumerSecret::decide(FALSE, ''),
    );
  }

}
