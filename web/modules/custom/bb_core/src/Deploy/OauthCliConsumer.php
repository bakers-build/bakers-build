<?php

declare(strict_types=1);

namespace Drupal\bb_core\Deploy;

/**
 * The required state of the shared public `bakers-cli` consumer.
 *
 * The named exception to the create-only contract (BB-550, extended): on an
 * existing consumer a deploy adds a missing grant and pins the access-token
 * lifetime, and touches nothing else — no secret, no scopes, no redirect.
 *
 * `refresh_token` is what lets the CLI renew a browser or device sign-in
 * without asking the human again: simple_oauth enables only the grants a
 * consumer lists, so without it the refresh token the device grant issues is
 * refused and the session dies with its access token.
 *
 * Dependency-free for unit tests; the caller is
 * `scripts/deploy/ensure-oauth.php`.
 */
final class OauthCliConsumer {

  /**
   * The grants the consumer must carry.
   */
  public const GRANTS = ['authorization_code', 'device_code', 'refresh_token'];

  /**
   * Access-token lifetime in seconds.
   */
  public const ACCESS_TOKEN_EXPIRATION = 3600;

  /**
   * The current grants plus every required grant still missing, in order.
   *
   * @param array<int, string> $grants
   *   The consumer's current grant types.
   *
   * @return array<int, string>
   *   The grant types the consumer must carry.
   */
  public static function grants(array $grants): array {
    return array_values(array_unique([...$grants, ...self::GRANTS]));
  }

}
