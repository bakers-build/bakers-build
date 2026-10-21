<?php

declare(strict_types=1);

namespace Drupal\bb_login_oauth;

use Drupal\social_auth\User\SocialAuthUserInterface;
use Drupal\social_auth_google\GoogleAuthManager;
use League\OAuth2\Client\Provider\Exception\IdentityProviderException;
use League\OAuth2\Client\Provider\GoogleUser;

/**
 * Keeps the one claim social_auth_google throws away.
 *
 * GOOGLE SENDS `email_verified` AND THE CONTRIB MANAGER DISCARDS IT. Its
 * `getUserInfo()` builds a SocialAuthUser from name, id, token, e-mail and
 * avatar; League's GoogleUser exposes `getEmailVerified()` and nothing calls
 * it. bakers.build keys accounts by e-mail, so that claim is the difference between a
 * sign-in and an account takeover.
 */
final class BbGoogleAuthManager extends GoogleAuthManager {

  /**
   * The key the decorated authenticator reads the assertion under.
   */
  public const VERIFIED_KEY = 'bb_email_verified';

  /**
   * Whether the verified-address claim has already been merged in.
   *
   * `getUserInfo()` is called more than once per callback (the parent
   * memoizes its own `$this->user` for exactly that reason), and without
   * this guard every call would repeat the extra userinfo round trip below.
   */
  private bool $verifiedClaimMerged = FALSE;

  /**
   * {@inheritdoc}
   *
   * Written into `additionalData`, never `addData()`/`customData`: only
   * `getAdditionalData()` is forwarded to `authenticateWithEmail()`
   * (`social_auth/src/User/UserAuthenticator.php:135`); `customData` is never
   * read back.
   */
  public function getUserInfo(): SocialAuthUserInterface {
    $user = parent::getUserInfo();
    if ($this->verifiedClaimMerged) {
      return $user;
    }

    // A SECOND CALL TO GOOGLE, MADE ONCE, GUARDED, AND CAUGHT. `parent::
    // getUserInfo()` already fetched the resource owner but keeps it local,
    // so this is the only way to reach `getEmailVerified()`; an
    // IdentityProviderException from it must not become an uncaught 500 —
    // an unreachable claim is treated the same as an unverified one.
    $verified = FALSE;
    try {
      /** @var \League\OAuth2\Client\Provider\GoogleUser $owner */
      $owner = $this->client->getResourceOwner($this->getAccessToken());
      $verified = $owner instanceof GoogleUser && $owner->getEmailVerified() === TRUE;
    }
    catch (IdentityProviderException $e) {
      $this->loggerFactory->get('bb_login_oauth')->error('Could not confirm the Google address: @message', ['@message' => $e->getMessage()]);
    }

    // STORED AS A STRICT BOOLEAN, never as the nullable the claim arrives as:
    // the decorator asks one question and a missing claim must answer "no",
    // not "unknown" — an unknown that reads as truthy is the takeover.
    $data = $user->getAdditionalData() ?? [];
    $data[self::VERIFIED_KEY] = $verified;
    $user->setAdditionalData($data);
    $this->verifiedClaimMerged = TRUE;
    return $user;
  }

}
