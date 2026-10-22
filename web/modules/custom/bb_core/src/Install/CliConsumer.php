<?php

declare(strict_types=1);

namespace Drupal\bb_core\Install;

/**
 * Creates the shared public `bakers-cli` OAuth consumer.
 *
 * The CLI signs a human in through the browser (authorization code + PKCE)
 * or the device grant, so the consumer carries no user and no secret.
 * `refresh_token` lets the CLI renew a session without asking again:
 * simple_oauth enables only the grants a consumer lists.
 */
final class CliConsumer {

  /**
   * The consumer's client id.
   */
  public const CLIENT_ID = 'bakers-cli';

  /**
   * The grants the consumer carries.
   */
  public const GRANTS = ['authorization_code', 'device_code', 'refresh_token'];

  /**
   * Access-token lifetime in seconds.
   */
  public const ACCESS_TOKEN_EXPIRATION = 3600;

  /**
   * This class is a namespaced function, not an object.
   */
  private function __construct() {}

  /**
   * Creates the consumer when it does not exist; an existing one is kept.
   */
  public static function ensure(): void {
    $storage = \Drupal::entityTypeManager()->getStorage('consumer');
    if ($storage->loadByProperties(['client_id' => self::CLIENT_ID])) {
      return;
    }
    $storage->create([
      'client_id' => self::CLIENT_ID,
      'label' => 'bakers.build CLI',
      'is_default' => FALSE,
      'confidential' => FALSE,
      'pkce' => TRUE,
      'grant_types' => self::GRANTS,
      'access_token_expiration' => self::ACCESS_TOKEN_EXPIRATION,
      'redirect' => 'http://localhost:7432/callback',
      'scopes' => [['scope_id' => 'bb_session']],
    ])->save();
  }

}
