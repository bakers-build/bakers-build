<?php

declare(strict_types=1);

namespace Drupal\bb_oauth_device\Plugin\Oauth2Grant;

use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Url;
use Drupal\consumers\Entity\Consumer;
use Drupal\simple_oauth\Plugin\Oauth2GrantBase;
use Drupal\simple_oauth\Repositories\OptionalRefreshTokenRepositoryInterface;
use League\OAuth2\Server\Grant\DeviceCodeGrant;
use League\OAuth2\Server\Grant\GrantTypeInterface;
use League\OAuth2\Server\Repositories\DeviceCodeRepositoryInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The RFC 8628 device authorization grant plugin.
 *
 * The plugin id is deliberately not the RFC's URN: DefaultPluginManager reads a
 * colon in a plugin id as the derivative separator, so "urn:ietf:..." would
 * never resolve. The URN reaches the wire from league's own getIdentifier(),
 * under which enableGrantType() registers this grant.
 *
 * @Oauth2Grant(
 *   id = "device_code",
 *   label = @Translation("Device Code"),
 * )
 */
class DeviceCode extends Oauth2GrantBase implements ContainerFactoryPluginInterface {

  /**
   * How long a device code stays live.
   *
   * Independent of any consumer's access token lifetime — long enough for a
   * human to switch devices and sign in before it lapses.
   */
  protected const DEVICE_CODE_TTL_SECONDS = 900;

  /**
   * Refresh token lifetime for a consumer that leaves its own field empty.
   *
   * The fallback simple_oauth's AuthorizationCode and RefreshToken grants
   * intend; their own check reads `->isEmpty` as a property and never takes
   * it, so keep the consumer's field set.
   */
  protected const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 1209600;

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    protected DeviceCodeRepositoryInterface $deviceCodeRepository,
    protected OptionalRefreshTokenRepositoryInterface $refreshTokenRepository,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('bb_oauth_device.repositories.device_code'),
      $container->get('simple_oauth.repositories.refresh_token')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getGrantType(Consumer $client): GrantTypeInterface {
    $device_code_ttl = new \DateInterval(sprintf('PT%dS', self::DEVICE_CODE_TTL_SECONDS));

    $verification_uri = Url::fromRoute('bb_oauth_device.verify')
      ->setAbsolute()
      ->toString(TRUE)
      ->getGeneratedUrl();

    // Refresh enablement and lifetime follow the consumer, as simple_oauth's
    // AuthorizationCode grant does. The repository service is shared and its
    // disablement is one-way, so a clone keeps a refresh-less consumer from
    // disabling refresh tokens for every later consumer in this container.
    $refresh_token_enabled = in_array('refresh_token', array_column($client->get('grant_types')->getValue(), 'value'), TRUE);
    $refresh_token_repository = clone $this->refreshTokenRepository;
    if (!$refresh_token_enabled) {
      $refresh_token_repository->disableRefreshToken();
    }

    $grant_type = new DeviceCodeGrant(
      $this->deviceCodeRepository,
      $refresh_token_repository,
      $device_code_ttl,
      $verification_uri
    );

    if ($refresh_token_enabled) {
      $expiration = $client->get('refresh_token_expiration');
      $seconds = $expiration->isEmpty() ? self::DEFAULT_REFRESH_TOKEN_TTL_SECONDS : (int) $expiration->value;
      $grant_type->setRefreshTokenTTL(new \DateInterval(sprintf('PT%dS', $seconds)));
    }

    // Both are optional in RFC 8628 §3.2 and both are read by the CLI: the
    // interval paces its polling, the complete URI saves the human typing the
    // code by hand.
    $grant_type->setIntervalVisibility(TRUE);
    $grant_type->setIncludeVerificationUriComplete(TRUE);

    // No setDefaultScope() here: AuthorizationServer::enableGrantType()
    // overwrites it. DeviceAuthorizationController::applyScope() supplies the
    // default instead.
    return $grant_type;
  }

}
