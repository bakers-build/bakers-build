<?php

declare(strict_types=1);

namespace Drupal\bb_oauth_device\Repositories;

use Drupal\Core\KeyValueStore\KeyValueExpirableFactoryInterface;
use Drupal\Core\KeyValueStore\KeyValueStoreExpirableInterface;
use Drupal\bb_oauth_device\Entities\DeviceCodeEntity;
use League\OAuth2\Server\Entities\DeviceCodeEntityInterface;
use League\OAuth2\Server\Repositories\ClientRepositoryInterface;
use League\OAuth2\Server\Repositories\DeviceCodeRepositoryInterface;
use League\OAuth2\Server\Repositories\ScopeRepositoryInterface;

/**
 * Stores device codes in the expirable key-value store.
 *
 * Two keys per code: the state under "code:<device code>", and a lookup index
 * under "user:<user code>" that the verification form resolves. Both carry the
 * code's own remaining lifetime, so an expired code simply stops existing and
 * no cleanup job is needed.
 */
class DeviceCodeRepository implements DeviceCodeRepositoryInterface {

  public const COLLECTION = 'bb_oauth_device_code';

  /**
   * Grace window past the logical expiry for the "code:" row.
   *
   * League's DeviceCodeGrant only reaches its own `expired_token` branch if
   * getDeviceCodeEntityByDeviceCode() still returns an entity after the
   * logical expiry; DatabaseStorageExpirable filters rows on `expire > now`,
   * so storing the row for exactly its logical lifetime makes it vanish at
   * the same instant, and league throws invalid_grant before ever reaching
   * the expired_token check. The "user:" index keeps the logical lifetime
   * unchanged, so the verification form still refuses a lapsed code.
   */
  protected const EXPIRY_GRACE_SECONDS = 60;

  public function __construct(
    protected KeyValueExpirableFactoryInterface $keyValueExpirableFactory,
    protected ClientRepositoryInterface $clientRepository,
    protected ScopeRepositoryInterface $scopeRepository,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function getNewDeviceCode(): DeviceCodeEntityInterface {
    return new DeviceCodeEntity();
  }

  /**
   * {@inheritdoc}
   */
  public function persistDeviceCode(DeviceCodeEntityInterface $deviceCodeEntity): void {
    $lifetime = $deviceCodeEntity->getExpiryDateTime()->getTimestamp() - time();
    if ($lifetime <= 0) {
      return;
    }

    $scopes = [];
    foreach ($deviceCodeEntity->getScopes() as $scope) {
      $scopes[] = $scope->getIdentifier();
    }

    $state = [
      'client_id' => $deviceCodeEntity->getClient()->getIdentifier(),
      'user_code' => $deviceCodeEntity->getUserCode(),
      'verification_uri' => $deviceCodeEntity->getVerificationUri(),
      'interval' => $deviceCodeEntity->getInterval(),
      'expires' => $deviceCodeEntity->getExpiryDateTime()->getTimestamp(),
      'user_id' => $deviceCodeEntity->getUserIdentifier(),
      'approved' => $deviceCodeEntity->getUserApproved(),
      'last_polled' => $deviceCodeEntity->getLastPolledAt()?->getTimestamp(),
      'scopes' => $scopes,
    ];

    $store = $this->store();
    $store->setWithExpire('code:' . $deviceCodeEntity->getIdentifier(), $state, $lifetime + self::EXPIRY_GRACE_SECONDS);
    $store->setWithExpire('user:' . $deviceCodeEntity->getUserCode(), $deviceCodeEntity->getIdentifier(), $lifetime);
  }

  /**
   * {@inheritdoc}
   */
  public function getDeviceCodeEntityByDeviceCode(string $deviceCodeEntity): ?DeviceCodeEntityInterface {
    $state = $this->store()->get('code:' . $deviceCodeEntity);

    return is_array($state) ? $this->hydrate($deviceCodeEntity, $state) : NULL;
  }

  /**
   * Resolves the human-entered user code to its device code entity.
   *
   * League defines no such lookup, but RFC 8628's verification step is driven
   * by the user code alone.
   */
  public function getDeviceCodeEntityByUserCode(string $userCode): ?DeviceCodeEntityInterface {
    $deviceCode = $this->store()->get('user:' . $userCode);

    return is_string($deviceCode) ? $this->getDeviceCodeEntityByDeviceCode($deviceCode) : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function revokeDeviceCode(string $codeId): void {
    $store = $this->store();
    $state = $store->get('code:' . $codeId);
    if (is_array($state)) {
      $store->delete('user:' . $state['user_code']);
    }
    $store->delete('code:' . $codeId);
  }

  /**
   * {@inheritdoc}
   */
  public function isDeviceCodeRevoked(string $codeId): bool {
    return $this->store()->get('code:' . $codeId) === NULL;
  }

  /**
   * Rebuilds the entity league handed us from the stored state.
   */
  protected function hydrate(string $deviceCode, array $state): ?DeviceCodeEntityInterface {
    if ($deviceCode === '') {
      return NULL;
    }

    $client = $this->clientRepository->getClientEntity($state['client_id']);
    if ($client === NULL) {
      return NULL;
    }

    $entity = new DeviceCodeEntity();
    $entity->setIdentifier($deviceCode);
    $entity->setUserCode($state['user_code']);
    $entity->setVerificationUri($state['verification_uri']);
    $entity->setInterval($state['interval']);
    $entity->setClient($client);
    $entity->setExpiryDateTime((new \DateTimeImmutable())->setTimestamp($state['expires']));
    $entity->setUserApproved((bool) $state['approved']);
    if ($state['user_id'] !== NULL) {
      $entity->setUserIdentifier($state['user_id']);
    }
    if ($state['last_polled'] !== NULL) {
      $entity->setLastPolledAt((new \DateTimeImmutable())->setTimestamp($state['last_polled']));
    }
    foreach ($state['scopes'] as $scopeId) {
      $scope = $this->scopeRepository->getScopeEntityByIdentifier($scopeId);
      if ($scope !== NULL) {
        $entity->addScope($scope);
      }
    }

    return $entity;
  }

  /**
   * The expirable key-value store this repository owns.
   */
  protected function store(): KeyValueStoreExpirableInterface {
    return $this->keyValueExpirableFactory->get(self::COLLECTION);
  }

}
