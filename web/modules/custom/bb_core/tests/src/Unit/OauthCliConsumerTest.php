<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\bb_core\Deploy\OauthCliConsumer;
use Drupal\Tests\UnitTestCase;
use Symfony\Component\Yaml\Yaml;

/**
 * @coversDefaultClass \Drupal\bb_core\Deploy\OauthCliConsumer
 *
 * @group bb_core
 */
final class OauthCliConsumerTest extends UnitTestCase {

  /**
   * A consumer seeded before the refresh grant existed gains it.
   *
   * @covers ::grants
   */
  public function testAddsTheMissingRefreshGrant(): void {
    self::assertSame(
      ['authorization_code', 'device_code', 'refresh_token'],
      OauthCliConsumer::grants(['authorization_code', 'device_code']),
    );
  }

  /**
   * A complete consumer is unchanged, and a grant added by hand is kept.
   *
   * @covers ::grants
   */
  public function testKeepsExistingGrants(): void {
    self::assertSame(
      ['refresh_token', 'device_code', 'authorization_code'],
      OauthCliConsumer::grants(['refresh_token', 'device_code', 'authorization_code']),
    );
    self::assertSame(
      ['authorization_code', 'implicit', 'device_code', 'refresh_token'],
      OauthCliConsumer::grants(['authorization_code', 'implicit']),
    );
  }

  /**
   * Every consumer grant is enabled on the bb:session scope, both copies.
   *
   * ScopeRepository::finalizeScopes() rejects a scope whose grant_types lack
   * league's identifier for the running grant, so a consumer grant missing
   * here mints nothing: invalid_scope. League names the device grant by its
   * RFC 8628 URN, not the plugin id the consumer stores.
   */
  public function testSessionScopeEnablesEveryConsumerGrant(): void {
    $root = dirname(__DIR__, 7);
    $league = ['device_code' => 'urn:ietf:params:oauth:grant-type:device_code'];
    foreach (['config/sync', 'recipes/bakers/config'] as $dir) {
      $scope = Yaml::parseFile("$root/$dir/simple_oauth.oauth2_scope.bb_session.yml");
      foreach (OauthCliConsumer::GRANTS as $grant) {
        self::assertTrue(
          $scope['grant_types'][$league[$grant] ?? $grant]['status'] ?? FALSE,
          "$dir: bb_session does not enable $grant",
        );
      }
    }
  }

}
