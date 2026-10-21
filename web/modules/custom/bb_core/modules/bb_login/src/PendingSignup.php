<?php

declare(strict_types=1);

namespace Drupal\bb_login;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\KeyValueStore\KeyValueExpirableFactoryInterface;
use Drupal\Core\KeyValueStore\KeyValueStoreExpirableInterface;

/**
 * The pending sign-up an unredeemed mail stands for.
 *
 * An address under a hashed nonce, expiring with the link.
 *
 * No account exists until someone redeems the mailed link or code, so typos
 * and scanners leave only an expiring row. Keyed by nonce, not address, so a
 * second request does not invalidate the first mail. Cron's key-value garbage
 * collection is the reaper.
 */
final class PendingSignup {

  /**
   * How long an unredeemed sign-up stays redeemable, in seconds.
   *
   * Twenty-four hours, matching what the mail has always promised of the
   * link. The row is unreadable past it (`DatabaseStorageExpirable::get()`
   * filters on the expiry) and `system_cron()` sweeps it, so nothing of ours
   * reaps.
   */
  public const TTL = 86400;

  /**
   * The expirable key-value collection pending sign-ups live in.
   */
  private const COLLECTION = 'bb_login.pending';

  /**
   * Constructs the pending sign-up store.
   *
   * @param \Drupal\Core\KeyValueStore\KeyValueExpirableFactoryInterface $keyValueExpirable
   *   Stores each pending sign-up with its own expiry.
   */
  public function __construct(
    private readonly KeyValueExpirableFactoryInterface $keyValueExpirable,
  ) {}

  /**
   * Records a sign-up nobody has proved yet, returning its nonce in the clear.
   *
   * @param string $mail
   *   The address to hold pending.
   *
   * @return string
   *   The plain nonce, for the mail body and nothing else.
   */
  public function issue(string $mail): string {
    // 32 bytes from the CSPRNG: this is the whole credential, so it is not
    // derived from anything guessable and needs no throttling to survive.
    $nonce = Crypt::randomBytesBase64(32);
    $this->store()->setWithExpire($this->key($nonce), ['mail' => $mail], self::TTL);
    return $nonce;
  }

  /**
   * The address a nonce stands for, consuming it.
   *
   * Ponytail: read-then-delete, not an atomic compare-and-delete —
   * `KeyValueStoreExpirableInterface` offers none. Two near-simultaneous
   * redemptions of one nonce (a double click, a browser plus its prefetcher)
   * can both pass this guard and both go on to create an account, since
   * `users_field_data.mail` carries no unique constraint either. Add a row
   * lock around claim-plus-create if that window needs closing.
   *
   * @param string $nonce
   *   The nonce as mailed.
   *
   * @return string|null
   *   The address, or NULL when the nonce is wrong, expired or already
   *   spent.
   */
  public function claim(string $nonce): ?string {
    $key = $this->key($nonce);
    $record = $this->store()->get($key);
    if (!is_array($record) || !isset($record['mail'])) {
      return NULL;
    }
    $this->store()->delete($key);
    return (string) $record['mail'];
  }

  /**
   * The stored form of a nonce.
   *
   * HASHED AT REST for the reason `LoginCode` hashes its code: a leak of the
   * table hands over nothing usable.
   *
   * @param string $nonce
   *   The plain nonce.
   *
   * @return string
   *   Its stored form.
   */
  private function key(string $nonce): string {
    return Crypt::hashBase64($nonce);
  }

  /**
   * The expirable store pending sign-ups live in.
   *
   * @return \Drupal\Core\KeyValueStore\KeyValueStoreExpirableInterface
   *   The store.
   */
  private function store(): KeyValueStoreExpirableInterface {
    return $this->keyValueExpirable->get(self::COLLECTION);
  }

}
