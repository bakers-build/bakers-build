<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\OAuth;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\user\UserInterface;
use League\OAuth2\Server\Entities\ClientEntityInterface;
use League\OAuth2\Server\Repositories\ClientRepositoryInterface;

/**
 * Decorates the Simple OAuth client repository for self-service keys only.
 *
 * Ordinary (unmanaged) consumers are delegated to the inner repository
 * unchanged — deploy-seeded and admin-made consumers keep their existing
 * behavior. A managed key additionally fails closed when it is disabled, its
 * marker is missing, its owner is gone, or it has reached its chosen expiry.
 * Simple OAuth itself enforces neither, so without this decorator a deleted
 * or expired key's secret would keep minting tokens for its 300-second
 * access-token lifetime and beyond.
 */
final class ApiKeyClientRepository implements ClientRepositoryInterface {

  public function __construct(
    private readonly ClientRepositoryInterface $inner,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ApiKeyManager $apiKeyManager,
    private readonly TimeInterface $time,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function getClientEntity(string $clientIdentifier): ?ClientEntityInterface {
    return $this->inner->getClientEntity($clientIdentifier);
  }

  /**
   * {@inheritdoc}
   */
  public function validateClient(string $clientIdentifier, ?string $clientSecret, ?string $grantType): bool {
    $consumer = $this->loadConsumer($clientIdentifier);

    // Not a consumer this decorator recognizes as a key: an ordinary
    // consumer, or an unknown client_id. Delegate as-is.
    if ($consumer === NULL || !$this->looksLikeKey($consumer)) {
      return $this->inner->validateClient($clientIdentifier, $clientSecret, $grantType);
    }

    // A client_id carrying the reserved prefix but missing its marker, owner
    // equality, confidentiality or the exact allowed grant/scope is a
    // damaged managed key: fail closed rather than silently falling back to
    // unlimited legacy-consumer behavior.
    if ($grantType === NULL || !$this->isValidManagedKey($consumer, $grantType)) {
      return FALSE;
    }

    return $this->inner->validateClient($clientIdentifier, $clientSecret, $grantType);
  }

  /**
   * Whether this client_id is recognized as a self-service key at all.
   *
   * Matches the real marker OR the reserved prefix, so a managed key with a
   * damaged marker still routes through the stricter checks below instead of
   * silently falling back to ordinary-consumer validation.
   */
  private function looksLikeKey(ConsumerInterface $consumer): bool {
    return $this->apiKeyManager->isManaged($consumer)
      || str_starts_with((string) $consumer->get('client_id')->value, ApiKeyManager::CLIENT_ID_PREFIX);
  }

  /**
   * Full managed-key validity: marker, expiry, status, owner and shape.
   */
  private function isValidManagedKey(ConsumerInterface $consumer, string $grantType): bool {
    return $this->apiKeyManager->isManaged($consumer)
      && $this->hasValidLifecycle($consumer)
      && $this->hasFixedShape($consumer, $grantType)
      && $this->hasConsistentActiveOwner($consumer);
  }

  /**
   * Enabled and not yet past its chosen expiry.
   */
  private function hasValidLifecycle(ConsumerInterface $consumer): bool {
    if ((bool) $consumer->get('status')->value !== TRUE) {
      return FALSE;
    }
    $expires = $consumer->get('bb_expires')->value;
    return $expires !== NULL && $expires !== '' && (int) $expires > $this->time->getCurrentTime();
  }

  /**
   * Confidential, client_credentials-only, bb_session-only.
   */
  private function hasFixedShape(ConsumerInterface $consumer, string $grantType): bool {
    if ((bool) $consumer->get('confidential')->value !== TRUE || $grantType !== 'client_credentials') {
      return FALSE;
    }
    $grants = array_column($consumer->get('grant_types')->getValue(), 'value');
    $scopes = array_column($consumer->get('scopes')->getValue(), 'scope_id');
    return $grants === ['client_credentials'] && $scopes === ['bb_session'];
  }

  /**
   * Owner and default user agree, and that account is active.
   */
  private function hasConsistentActiveOwner(ConsumerInterface $consumer): bool {
    $ownerId = $consumer->get('owner_id')->target_id;
    $userId = $consumer->get('user_id')->target_id;
    if (!$ownerId || !$userId || (int) $ownerId !== (int) $userId) {
      return FALSE;
    }
    $owner = $consumer->get('user_id')->entity;
    return $owner instanceof UserInterface && $owner->isActive();
  }

  /**
   * Loads the consumer for a client_id, or NULL when none exists.
   */
  private function loadConsumer(string $clientIdentifier): ?ConsumerInterface {
    $matches = $this->entityTypeManager->getStorage('consumer')->loadByProperties(['client_id' => $clientIdentifier]);
    $consumer = reset($matches);
    return $consumer instanceof ConsumerInterface ? $consumer : NULL;
  }

}
