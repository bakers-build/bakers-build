<?php

declare(strict_types=1);

namespace Drupal\bb_core\Deploy;

/**
 * Pure create-only provisioning decision for the OAuth bootstrap.
 *
 * Consumers are seeded once from the env; an existing consumer is never
 * touched (its secret is UI-managed), so a deploy can never overwrite a
 * working secret. Which accounts qualify is OauthConsumerCandidates' job.
 * Dependency-free for unit tests; the caller is
 * `scripts/deploy/ensure-oauth.php`.
 */
final class OauthConsumerSecret {

  /**
   * The consumer already exists — leave it entirely untouched (UI-managed).
   */
  public const SKIP_EXISTING = 'skip_existing';

  /**
   * The consumer is missing and the env carries a secret — create it (seed).
   */
  public const CREATE = 'create';

  /**
   * The consumer is missing but no secret is in the env — cannot seed; skip.
   */
  public const SKIP_EMPTY = 'skip_empty';

  /**
   * Decide whether to seed a consumer at bootstrap time.
   *
   * @param bool $consumerExists
   *   Whether a consumer for this client_id already exists.
   * @param string $incoming
   *   The plaintext secret from the env var ('' when the var is unset/empty).
   *
   * @return string
   *   One of the SKIP_EXISTING / CREATE / SKIP_EMPTY constants.
   */
  public static function decide(bool $consumerExists, string $incoming): string {
    if ($consumerExists) {
      return self::SKIP_EXISTING;
    }
    if ($incoming === '') {
      return self::SKIP_EMPTY;
    }
    return self::CREATE;
  }

}
