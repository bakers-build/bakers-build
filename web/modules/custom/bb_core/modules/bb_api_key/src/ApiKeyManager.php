<?php

declare(strict_types=1);

namespace Drupal\bb_api_key;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Component\Utility\Crypt;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\simple_oauth\Plugin\Validation\Constraint\Oauth2PrivilegedConsumerField;

/**
 * Creates, classifies and revokes self-service pipeline API keys.
 *
 * A key is a Simple OAuth `consumer` content entity marked by a nonempty
 * `bb_key_created` timestamp, so it is identifiable without a reserved
 * naming convention alone — a damaged `client_id` on a real consumer never
 * widens into this class. Every other consumer (deploy-seeded, admin-made)
 * is left untouched.
 */
final class ApiKeyManager {

  /**
   * The `client_id` prefix for a generated key.
   */
  public const CLIENT_ID_PREFIX = 'bakers-key-';

  /**
   * Access tokens minted for a key live this long (seconds).
   *
   * Short on purpose: a key that is deleted or expires outlives itself by at
   * most this window, because Simple OAuth does not revoke on consumer
   * deletion on its own (`hook_consumer_delete` must do it, see
   * ApiKeyHooks::consumerDelete()).
   */
  public const ACCESS_TOKEN_EXPIRATION = 300;

  /**
   * Minimum accepted expiry: tomorrow.
   */
  public const MIN_DAYS_AHEAD = 1;

  /**
   * Maximum accepted expiry: 365 days ahead.
   */
  public const MAX_DAYS_AHEAD = 365;

  /**
   * Default expiry when the user accepts the suggestion.
   */
  public const DEFAULT_DAYS_AHEAD = 90;

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly TimeInterface $time,
  ) {}

  /**
   * Whether this consumer is a self-service key, not an ordinary consumer.
   */
  public function isManaged(ConsumerInterface $consumer): bool {
    $created = $consumer->get('bb_key_created')->value;
    return $created !== NULL && $created !== '';
  }

  /**
   * Whether a managed key belongs to the given account.
   *
   * An ordinary (unmanaged) consumer is never "owned" through this class:
   * the self-service UI and OAuth decorators must not manage or authenticate
   * as a consumer an administrator created some other way.
   */
  public function isOwnedBy(ConsumerInterface $consumer, AccountInterface $account): bool {
    if (!$this->isManaged($consumer)) {
      return FALSE;
    }
    $ownerId = (int) $consumer->get('owner_id')->target_id;
    $userId = (int) $consumer->get('user_id')->target_id;
    return $ownerId === (int) $account->id() && $userId === (int) $account->id();
  }

  /**
   * Parses a `Y-m-d` expiry date into the stored end-of-UTC-day timestamp.
   *
   * Accepted range: tomorrow (UTC, relative to the injected time service)
   * through self::MAX_DAYS_AHEAD days ahead, inclusive. Rejects missing,
   * malformed, noncanonical (e.g. "2026-02-30") and out-of-range dates.
   *
   * @throws \InvalidArgumentException
   *   When the date is missing, malformed, or outside the accepted range.
   */
  public function expiryTimestamp(string $date): int {
    $date = trim($date);
    if ($date === '') {
      throw new \InvalidArgumentException('An expiry date is required.');
    }
    $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date, new \DateTimeZone('UTC'));
    if ($parsed === FALSE || $parsed->format('Y-m-d') !== $date) {
      throw new \InvalidArgumentException('The expiry date is not a valid calendar date.');
    }

    $today = (new \DateTimeImmutable('@' . $this->time->getCurrentTime()))->setTimezone(new \DateTimeZone('UTC'));
    $todayMidnight = $today->setTime(0, 0, 0);
    $minDate = $todayMidnight->modify('+' . self::MIN_DAYS_AHEAD . ' day');
    $maxDate = $todayMidnight->modify('+' . self::MAX_DAYS_AHEAD . ' day');

    if ($parsed < $minDate || $parsed > $maxDate) {
      throw new \InvalidArgumentException('The expiry date must be between tomorrow and one year from today (UTC).');
    }

    // The key is valid through the selected day: store the following
    // midnight UTC, so "now >= bb_expires" is the expiry test everywhere
    // else (ApiKeyClientRepository, the Views status field).
    return $parsed->modify('+1 day')->getTimestamp();
  }

  /**
   * The default expiry date offered on the create form, as `Y-m-d` UTC.
   */
  public function defaultExpiryDate(): string {
    $today = (new \DateTimeImmutable('@' . $this->time->getCurrentTime()))->setTimezone(new \DateTimeZone('UTC'));
    return $today->modify('+' . self::DEFAULT_DAYS_AHEAD . ' day')->format('Y-m-d');
  }

  /**
   * Creates a new self-service key for the given account.
   *
   * Every security-relevant field is fixed here, never taken from a form:
   * confidential, client_credentials-only, bb_session-only, the short
   * token lifetime, and both owner fields set to the authenticated account.
   *
   * @return array{consumer: \Drupal\consumers\Entity\ConsumerInterface, secret: string}
   *   The saved consumer and the plaintext secret. The secret exists only in
   *   this return value and in request memory; it is never logged or stored
   *   anywhere other than the consumer's own hashed `secret` field.
   */
  public function create(AccountInterface $account, string $label, int $expires): array {
    $label = trim($label);
    if ($label === '') {
      throw new \InvalidArgumentException('A name is required.');
    }
    if (mb_strlen($label) > 255) {
      throw new \InvalidArgumentException('The name must be 255 characters or fewer.');
    }
    if ($expires <= $this->time->getCurrentTime()) {
      throw new \InvalidArgumentException('The expiry must be in the future.');
    }

    $secret = Crypt::randomBytesBase64(32);
    $storage = $this->entityTypeManager->getStorage('consumer');
    /** @var \Drupal\consumers\Entity\ConsumerInterface $consumer */
    $consumer = $storage->create([
      'client_id' => self::CLIENT_ID_PREFIX . Crypt::randomBytesBase64(16),
      'label' => $label,
      'secret' => $secret,
      'owner_id' => $account->id(),
      'user_id' => $account->id(),
      'is_default' => FALSE,
      'status' => TRUE,
      'confidential' => TRUE,
      'grant_types' => ['client_credentials'],
      'scopes' => [['scope_id' => 'bb_session']],
      'access_token_expiration' => self::ACCESS_TOKEN_EXPIRATION,
      'bb_key_created' => $this->time->getCurrentTime(),
      'bb_expires' => $expires,
    ]);

    $messages = [];
    foreach ($consumer->validate() as $violation) {
      // That constraint stops a user choosing privileged grants, scopes or a
      // user; here this code fixes all three, and callers check who may create.
      if (!$violation->getConstraint() instanceof Oauth2PrivilegedConsumerField) {
        $messages[] = (string) $violation->getMessage();
      }
    }
    if ($messages) {
      throw new \InvalidArgumentException(implode(' ', $messages));
    }

    $storage->save($consumer);

    return ['consumer' => $consumer, 'secret' => $secret];
  }

  /**
   * Revokes (deletes) a key the account owns.
   *
   * Token cleanup happens in ApiKeyHooks::consumerDelete(), which runs
   * synchronously as part of this same entity delete.
   *
   * @throws \InvalidArgumentException
   *   When the account does not own this key.
   */
  public function revoke(ConsumerInterface $consumer, AccountInterface $account): void {
    if (!$this->isOwnedBy($consumer, $account)) {
      throw new \InvalidArgumentException('This key does not belong to the given account.');
    }
    $consumer->delete();
  }

}
