<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Authentication;

use Drupal\Core\Authentication\AuthenticationProviderInterface;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\simple_oauth\Authentication\TokenAuthUser;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Exception\OAuthUnauthorizedHttpException;
use Symfony\Component\HttpFoundation\Request;

/**
 * Converts a managed key's token identity to its exact owning user.
 *
 * Simple OAuth's `client_credentials` grant normally authenticates as a
 * `TokenAuthUser` whose permissions are the scope's permission set, not the
 * owner's own roles (`Oauth2AccessPolicy::alterPermissions()` overwrites
 * them). For a self-service key AC-4 requires the exact opposite: the token
 * must carry precisely the owner's current permissions, including later
 * role/membership changes. Returning the inner provider's `getSubject()` —
 * a plain Drupal user entity — does that, because ordinary Drupal permission
 * checking (not the scope override) then applies.
 *
 * Every other request — ordinary machine consumers, human OAuth, cookie
 * sessions — is returned unchanged; this decorator narrows nothing except
 * requests that authenticated as a managed key.
 */
final class ApiKeyAuthenticationProvider implements AuthenticationProviderInterface {

  public function __construct(
    private readonly AuthenticationProviderInterface $inner,
    private readonly ApiKeyManager $apiKeyManager,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function applies(Request $request): bool {
    return $this->inner->applies($request);
  }

  /**
   * {@inheritdoc}
   */
  public function authenticate(Request $request) {
    try {
      $account = $this->inner->authenticate($request);
    }
    catch (\TypeError $error) {
      // A token row whose client consumer was deleted after the row was read
      // (the delete hook's token cleanup is not transactional with that read)
      // makes the inner provider's `new TokenAuthUser(...)` assign NULL to its
      // typed `Consumer` property. Only that origin is translated; any other
      // TypeError must propagate rather than become a silent 401.
      if (!$this->isOrphanTokenTypeError($error)) {
        throw $error;
      }
      throw $this->invalidTokenException($request, $error);
    }

    if (!$account instanceof TokenAuthUserInterface) {
      return $account;
    }

    $consumer = $account->getConsumer();
    if (!$this->apiKeyManager->isManaged($consumer)) {
      return $account;
    }

    // Re-check the owner invariant at authentication time too (not only at
    // token-mint time): a key whose owner has since diverged from its
    // `user_id` default, or whose owner account is blocked, must not
    // silently keep authenticating as that user.
    $subject = $account->getSubject();
    $ownerId = $consumer->get('owner_id')->target_id;
    if (!$subject->isActive() || (int) $ownerId !== (int) $subject->id()) {
      throw $this->invalidTokenException($request, NULL);
    }

    return $subject;
  }

  /**
   * Whether a TypeError originates in the inner provider's TokenAuthUser build.
   *
   * `SimpleOauthAuthenticationProvider::authenticate()` loads the token row by
   * value and immediately constructs a `TokenAuthUser` from it with no NULL
   * check; an orphan token (the row vanished) is the one way that call fails
   * with a TypeError instead of a clean rejection.
   */
  private function isOrphanTokenTypeError(\TypeError $error): bool {
    $frame = $error->getTrace()[0] ?? NULL;
    return is_array($frame)
      && ($frame['class'] ?? NULL) === TokenAuthUser::class
      && ($frame['function'] ?? NULL) === '__construct';
  }

  /**
   * Builds the 401 a resource-server client expects for a bad bearer token.
   */
  private function invalidTokenException(Request $request, ?\Throwable $previous): OAuthUnauthorizedHttpException {
    $scheme = str_starts_with((string) $request->headers->get('Authorization'), 'Bearer') ? 'Bearer' : 'Basic';
    return new OAuthUnauthorizedHttpException(
      sprintf('%s realm="OAuth", error="invalid_token"', $scheme),
      'The access token is invalid.',
      $previous,
    );
  }

}
