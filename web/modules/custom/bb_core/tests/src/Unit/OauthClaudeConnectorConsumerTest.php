<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\bb_core\Deploy\OauthClaudeConnectorConsumer;
use Drupal\Tests\UnitTestCase;

/**
 * @coversDefaultClass \Drupal\bb_core\Deploy\OauthClaudeConnectorConsumer
 *
 * @group bb_core
 */
final class OauthClaudeConnectorConsumerTest extends UnitTestCase {

  /**
   * A consumer that exactly matches the contract has no mismatches.
   *
   * @covers ::mismatches
   */
  public function testCompatibleConsumerHasNoMismatches(): void {
    self::assertSame([], OauthClaudeConnectorConsumer::mismatches(self::actual()));
  }

  /**
   * An existing confidential consumer (wrong client type) is flagged.
   *
   * @covers ::mismatches
   */
  public function testConfidentialConsumerIsFlagged(): void {
    $actual = self::actual();
    $actual['confidential'] = TRUE;

    self::assertSame(['confidential'], OauthClaudeConnectorConsumer::mismatches($actual));
  }

  /**
   * A wrong redirect URI is flagged.
   *
   * This is the field an attacker-controlled or merely mistyped value would
   * be most dangerous on.
   *
   * @covers ::mismatches
   */
  public function testWrongRedirectIsFlagged(): void {
    $actual = self::actual();
    $actual['redirect'] = 'https://evil.example/callback';

    self::assertSame(['redirect'], OauthClaudeConnectorConsumer::mismatches($actual));
  }

  /**
   * A consumer missing the refresh_token grant is flagged.
   *
   * @covers ::mismatches
   */
  public function testMissingRefreshGrantIsFlagged(): void {
    $actual = self::actual();
    $actual['grant_types'] = ['authorization_code'];

    self::assertSame(['grant_types'], OauthClaudeConnectorConsumer::mismatches($actual));
  }

  /**
   * Several mismatches at once are each named individually.
   *
   * PKCE disabled, no scope, and auto-authorization skipping consent.
   *
   * @covers ::mismatches
   */
  public function testMultipleMismatchesAreAllNamed(): void {
    $actual = self::actual();
    $actual['pkce'] = FALSE;
    $actual['scopes'] = [];
    $actual['automatic_authorization'] = TRUE;

    self::assertSame(
      ['pkce', 'scopes', 'automatic_authorization'],
      OauthClaudeConnectorConsumer::mismatches($actual),
    );
  }

  /**
   * A field absent from "actual" is flagged like a wrong value.
   *
   * E.g. a differently-shaped consumer.
   *
   * @covers ::mismatches
   */
  public function testAbsentFieldIsFlagged(): void {
    $compared = OauthClaudeConnectorConsumer::requiredFields();
    unset($compared['client_id'], $compared['label']);
    self::assertSame(array_keys($compared), OauthClaudeConnectorConsumer::mismatches([]));
  }

  /**
   * BB-688: the legacy client_id carries the identical contract.
   *
   * @covers ::requiredFields
   */
  public function testLegacyClientIdSharesContractExceptId(): void {
    $current = OauthClaudeConnectorConsumer::requiredFields();
    $legacy = OauthClaudeConnectorConsumer::requiredFields(OauthClaudeConnectorConsumer::LEGACY_CLIENT_ID);

    self::assertSame(OauthClaudeConnectorConsumer::CLIENT_ID, $current['client_id']);
    self::assertSame(OauthClaudeConnectorConsumer::LEGACY_CLIENT_ID, $legacy['client_id']);
    unset($current['client_id'], $current['label'], $legacy['client_id'], $legacy['label']);
    self::assertSame($current, $legacy);
  }

  /**
   * A relabelled consumer is still compatible.
   *
   * @covers ::mismatches
   */
  public function testRelabelledConsumerIsCompatible(): void {
    $actual = self::actual();
    $actual['label'] = 'Renamed in the UI';

    self::assertSame([], OauthClaudeConnectorConsumer::mismatches($actual));
  }

  /**
   * The "actual" shape `mismatches()` expects from a saved consumer.
   *
   * Unlike `requiredFields()` (shaped for `Consumer::create()`, where
   * `scopes` is `[['scope_id' => ...]]`), the caller gathering an existing
   * entity's values hands `scopes` as a flat list of scope_id strings.
   *
   * @return array<string, mixed>
   *   The flat "actual" shape.
   */
  private static function actual(): array {
    $actual = OauthClaudeConnectorConsumer::requiredFields();
    $actual['scopes'] = array_column($actual['scopes'], 'scope_id');

    return $actual;
  }

}
