<?php

declare(strict_types=1);

namespace Drupal\bb_core\Deploy;

/**
 * The required state of the shared public `claude-connector` consumer.
 *
 * BB-658: lets a keytec member connect their own claude.ai account to bakers.build
 * via a FIXED public OAuth client — Authorization Code + mandatory S256 PKCE,
 * plus a refresh token, no dynamic client registration. One consumer serves
 * every connecting user; identity comes from the browser login + consent step
 * each user goes through, not from a `user_id` bound on the consumer (unlike
 * the per-user `client_credentials` consumers `ensure-oauth.php` seeds).
 *
 * CREATE-ONLY, like `bakers-cli` (BB-494/550) and the per-user consumers
 * (BB-111): seeded once, when missing. Unlike `bakers-cli`, an existing
 * consumer is NEVER patched even partially — a mismatch is reported loudly
 * (UpdateException in the deploy hook) rather than silently overwritten or
 * silently ignored, because a wrong grant or redirect here is a wrong OAuth
 * client a real external party (claude.ai) is configured against.
 *
 * BB-688: the public client is `bakers-claude`, carrying the same contract.
 * The original `claude-connector` client_id is kept as a legacy constant so
 * `bb_core_deploy_bb_658_claude_connector_consumer()` keeps provisioning
 * and validating it unchanged on already-upgraded installations — this class
 * never patches, renames or revokes that entity, it only still knows its ID.
 *
 * Dependency-free for unit tests; the callers are
 * `bb_core_deploy_bb_658_claude_connector_consumer()` (legacy) and
 * `bb_core_deploy_bb_688_claude_consumer()` (current).
 */
final class OauthClaudeConnectorConsumer {

  /**
   * The current public client's client_id.
   */
  public const CLIENT_ID = 'bakers-claude';

  /**
   * The retired public client's client_id (BB-658), kept create-only.
   */
  public const LEGACY_CLIENT_ID = 'claude-connector';

  /**
   * The grants the consumer must carry, in order.
   */
  public const GRANTS = ['authorization_code', 'refresh_token'];

  /**
   * The one bakers.build scope (`bb:session`), per the single-scope project rule.
   *
   * BB-658 review decision F7: the connector carries no dedicated OAuth
   * scope. The per-bundle operation matrix is bounded by the dropsh MCP
   * allowlist, the connecting user's own Drupal permissions and workspace
   * rank, and the project instructions — not by a scope ceiling. Because this
   * consumer uses `authorization_code` (a real human login), the connecting
   * human never gets more than their own role already grants.
   */
  public const SCOPE = 'bb_session';

  /**
   * Claude.ai's fixed OAuth redirect URI for its MCP connector.
   */
  public const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

  /**
   * The fields a FRESH consumer must be created with.
   *
   * @param string $clientId
   *   The client_id to seed — `self::CLIENT_ID` (default) or
   *   `self::LEGACY_CLIENT_ID`. Every other field is identical: both clients
   *   share one contract, only the ID differs.
   *
   * @return array<string, mixed>
   *   Field name => value, ready for `Consumer::create()` plus `->set()`.
   */
  public static function requiredFields(string $clientId = self::CLIENT_ID): array {
    return [
      'client_id' => $clientId,
      'label' => $clientId === self::CLIENT_ID ? 'bakers.build Claude connector' : 'Claude.ai connector',
      'is_default' => FALSE,
      'confidential' => FALSE,
      'grant_types' => self::GRANTS,
      'redirect' => self::REDIRECT_URI,
      'pkce' => TRUE,
      'scopes' => [['scope_id' => self::SCOPE]],
      'automatic_authorization' => FALSE,
    ];
  }

  /**
   * Which of the required fields an EXISTING consumer disagrees on.
   *
   * Compares only the fields this contract cares about. `client_id` (the
   * caller loaded by it) and `label` (editable in the UI) are skipped; the
   * caller checks `secret` and `user_id` for the current client only.
   *
   * @param array<string, mixed> $actual
   *   The existing consumer's current values for the same field names,
   *   gathered by the caller (grant_types as a plain list of strings, scopes
   *   as a plain list of scope_id strings — same shapes as requiredFields()).
   *
   * @return array<int, string>
   *   The field names that mismatch, empty when the consumer is compatible.
   */
  public static function mismatches(array $actual): array {
    $required = self::requiredFields();
    unset($required['client_id'], $required['label']);
    // `requiredFields()['scopes']` is shaped for `Consumer::create()`
    // (`[['scope_id' => ...]]`); `$actual['scopes']` is the flat list of
    // scope_id strings the caller gathers from a saved entity. Flatten the
    // required shape the same way before comparing, so this is the one place
    // that shape difference is reconciled.
    $required['scopes'] = array_column($required['scopes'], 'scope_id');
    $mismatched = [];

    foreach ($required as $field => $expected) {
      $given = $actual[$field] ?? NULL;

      $normalise = static function ($value): mixed {
        if (is_array($value)) {
          sort($value);
        }
        return $value;
      };

      if ($normalise($given) !== $normalise($expected)) {
        $mismatched[] = $field;
      }
    }

    return $mismatched;
  }

}
