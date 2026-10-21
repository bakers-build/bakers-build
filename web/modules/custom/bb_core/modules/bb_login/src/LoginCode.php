<?php

declare(strict_types=1);

namespace Drupal\bb_login;

use Drupal\Component\Utility\Crypt;
use Drupal\Core\KeyValueStore\KeyValueExpirableFactoryInterface;
use Drupal\Core\Site\Settings;

/**
 * The six-digit code that rides along with the login link.
 *
 * Mail scanners prefetch and spend one-time links, so the mail also carries
 * a code nothing automated types. Core has no short code, so generation,
 * storage and verification are ours; the constants below are the whole
 * security surface and are deliberately not configurable.
 *.
 */
final class LoginCode {

  /**
   * How many digits the code has.
   *
   * Six, as Linear and most of the industry use: short enough to carry across
   * a room, long enough that a million possibilities plus the attempt limit
   * below makes guessing pointless.
   */
  public const LENGTH = 6;

  /**
   * How long a code stays valid, in seconds.
   *
   * FIFTEEN MINUTES, and deliberately far shorter than the LINK's twenty-four
   * hours. A six-digit code is a million possibilities; the link's token is
   * effectively unguessable, so it can afford a long window and the code
   * cannot. Both are invalidated the moment either one is used.
   */
  public const TTL = 900;

  /**
   * How many wrong codes an address may offer before it is refused.
   *
   * WITHOUT THIS THE CODE IS THE WEAK DOOR. A million possibilities falls in
   * minutes to an unthrottled loop, so this limit — not the length — is what
   * makes the code safe. It counts per ADDRESS, so an attacker cannot spread
   * the guesses across networks.
   */
  public const MAX_ATTEMPTS = 5;

  /**
   * The flood event the attempt limit is counted under.
   */
  public const FLOOD_EVENT = 'bb_login.code_attempt';

  /**
   * The expirable key-value collection codes live in.
   */
  private const COLLECTION = 'bb_login.code';

  /**
   * Constructs the code service.
   *
   * @param \Drupal\Core\KeyValueStore\KeyValueExpirableFactoryInterface $keyValueExpirable
   *   Stores each code with its own expiry, so a lapsed code disappears
   *   without anything having to sweep it.
   */
  public function __construct(
    private readonly KeyValueExpirableFactoryInterface $keyValueExpirable,
  ) {}

  /**
   * Issues a fresh code for an account and returns it in the clear.
   *
   * RETURNED ONCE AND STORED HASHED. The caller puts the plain code in the
   * mail and then has no way to read it back, which is the property that makes
   * a leak of this table useless on its own.
   *
   * @param string $mail
   *   The address the code was requested for.
   * @param int $uid
   *   The account the code signs in.
   *
   * @return string
   *   The plain code, for the mail body and nothing else.
   */
  public function issue(string $mail, int $uid): string {
    // `random_int()` and not `rand()`: this is a credential, so it comes from
    // the CSPRNG. Zero-padded, because a leading zero is part of the code and
    // dropping it would quietly shrink the space by a tenth.
    $code = str_pad((string) random_int(0, 10 ** self::LENGTH - 1), self::LENGTH, '0', STR_PAD_LEFT);
    $this->store()->setWithExpire($this->key($mail), [
      'uid' => $uid,
      'hash' => $this->hash($code),
    ], self::TTL);
    return $code;
  }

  /**
   * The account a code signs in, or NULL when it does not.
   *
   * CONSUMED ON SUCCESS. A code that stays valid after use is a second key to
   * the same door, and the whole point of the pair is that each half is spent
   * once. A WRONG code is deliberately NOT consumed — a typo must not lock the
   * customer out of a code they hold — which is exactly why the caller has to
   * throttle attempts.
   *
   * @param string $mail
   *   The address the code was issued for.
   * @param string $candidate
   *   What the customer typed.
   *
   * @return int|null
   *   The uid, or NULL when the code is wrong, expired or already used.
   */
  public function claim(string $mail, string $candidate): ?int {
    $record = $this->store()->get($this->key($mail));
    if (!is_array($record) || !isset($record['uid'], $record['hash'])) {
      return NULL;
    }
    // Digits only, and whitespace tolerated: people paste "123 456" out of a
    // mail client that broke the line, and refusing that would be a puzzle
    // rather than a security measure.
    $candidate = preg_replace('/\D+/', '', $candidate) ?? '';
    if ($candidate === '') {
      return NULL;
    }
    // `hash_equals` and not `===`: the comparison runs on a secret, and a
    // timing difference is a side channel however small.
    if (!hash_equals((string) $record['hash'], $this->hash($candidate))) {
      return NULL;
    }
    $this->store()->delete($this->key($mail));
    return (int) $record['uid'];
  }

  /**
   * Discards any code held for an address.
   *
   * Called when the LINK is used, so the two halves of one mail cannot both be
   * spent: whichever arrives first ends the other.
   *
   * @param string $mail
   *   The address whose code is void.
   */
  public function discard(string $mail): void {
    $this->store()->delete($this->key($mail));
  }

  /**
   * The stored form of a code.
   *
   * HMAC WITH THE SITE'S HASH SALT rather than a password hash. The value is
   * six digits with a fifteen-minute life, so an attacker holding this table
   * can brute-force any hash function faster than the code expires — which
   * means the hash is not what protects it; the TTL and the attempt limit are.
   * What the HMAC does buy is real and worth having: the table never contains
   * a code that can be read and used directly, so a log dump, a backup or an
   * over-broad query hands over nothing usable.
   *
   * @param string $code
   *   The plain code.
   *
   * @return string
   *   Its stored form.
   */
  private function hash(string $code): string {
    return Crypt::hmacBase64($code, Settings::getHashSalt() . self::COLLECTION);
  }

  /**
   * The storage key for an address.
   *
   * HASHED, so the key-value table is not a list of everybody who has tried to
   * sign in. Lower-cased first, because a code follows the address and an
   * address is not case-sensitive.
   *
   * @param string $mail
   *   The address.
   *
   * @return string
   *   Its key.
   */
  private function key(string $mail): string {
    return Crypt::hashBase64(mb_strtolower(trim($mail)));
  }

  /**
   * The expirable store codes live in.
   *
   * @return \Drupal\Core\KeyValueStore\KeyValueStoreExpirableInterface
   *   The store.
   */
  private function store() {
    return $this->keyValueExpirable->get(self::COLLECTION);
  }

}
