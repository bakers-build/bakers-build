<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\Authentication;

use Drupal\Core\Authentication\AuthenticationProviderInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_api_key\ApiKeyManager;
use Drupal\consumers\Entity\ConsumerInterface;
use Drupal\simple_oauth\Authentication\TokenAuthUser;
use Drupal\simple_oauth\Authentication\TokenAuthUserInterface;
use Drupal\simple_oauth\Exception\OAuthUnauthorizedHttpException;
use Drupal\user\UserInterface;
use League\OAuth2\Server\Exception\OAuthServerException;
use League\OAuth2\Server\Repositories\ClientRepositoryInterface;
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
 * On `/mcp` the key itself is accepted as the bearer too, as
 * `Bearer <client_id>:<secret>`, for clients that send a fixed header and
 * cannot refresh a token. It runs the same checks as the token exchange
 * (ApiKeyClientRepository::validateClient()) on every request and
 * authenticates as the key's owner; any failure is a 401. A key-shaped bearer
 * anywhere else goes to the inner provider, which rejects it as before.
 *
 * Every other request — ordinary machine consumers, human OAuth, cookie
 * sessions — is returned unchanged; this decorator narrows nothing except
 * requests that authenticated as a managed key.
 */
final class ApiKeyAuthenticationProvider implements AuthenticationProviderInterface {

  /**
   * The only path that accepts a key as the bearer.
   */
  private const KEY_BEARER_PATH = '/mcp';

  public function __construct(
    private readonly AuthenticationProviderInterface $inner,
    private readonly ApiKeyManager $apiKeyManager,
    private readonly ClientRepositoryInterface $clientRepository,
    private readonly EntityTypeManagerInterface $entityTypeManager,
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
    $key = $this->keyBearer($request);
    if ($key !== NULL) {
      return $this->keyOwner($request, ...$key);
    }
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
   * The client id and secret of a key sent as the bearer on `/mcp`.
   *
   * Neither part can hold a `:` (both are base64), and a JWT has none either.
   *
   * @return array{0: string, 1: string}|null
   *   The client id and secret, or NULL for any other request.
   */
  private function keyBearer(Request $request): ?array {
    if ($request->getPathInfo() !== self::KEY_BEARER_PATH) {
      return NULL;
    }
    $header = (string) $request->headers->get('Authorization');
    if (!str_starts_with($header, 'Bearer ')) {
      return NULL;
    }
    $credentials = trim(substr($header, 7));
    if (!str_starts_with($credentials, ApiKeyManager::CLIENT_ID_PREFIX) || !str_contains($credentials, ':')) {
      return NULL;
    }
    [$clientId, $secret] = explode(':', $credentials, 2);
    return [$clientId, $secret];
  }

  /**
   * The owner of a valid key, or a 401.
   *
   * @throws \Drupal\simple_oauth\Exception\OAuthUnauthorizedHttpException
   */
  private function keyOwner(Request $request, string $clientId, string $secret): UserInterface {
    if ($secret === '' || !$this->clientRepository->validateClient($clientId, $secret, 'client_credentials')) {
      throw $this->invalidTokenException($request, NULL);
    }
    $consumers = $this->entityTypeManager->getStorage('consumer')->loadByProperties(['client_id' => $clientId]);
    $consumer = reset($consumers);
    $owner = $consumer instanceof ConsumerInterface ? $consumer->get('user_id')->entity : NULL;
    if (!$consumer instanceof ConsumerInterface || !$this->apiKeyManager->isManaged($consumer) || !$owner instanceof UserInterface) {
      throw $this->invalidTokenException($request, NULL);
    }
    return $owner;
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
   *
   * The previous exception is always a League OAuthServerException:
   * simple_oauth's exception logger reads its hint and fails on anything else.
   */
  private function invalidTokenException(Request $request, ?\Throwable $previous): OAuthUnauthorizedHttpException {
    $scheme = str_starts_with((string) $request->headers->get('Authorization'), 'Bearer') ? 'Bearer' : 'Basic';
    $message = 'The access token is invalid.';
    return new OAuthUnauthorizedHttpException(
      sprintf('%s realm="OAuth", error="invalid_token"', $scheme),
      $message,
      new OAuthServerException($message, 9, 'invalid_token', 401, 'The key, token or owner is not valid.', NULL, $previous),
    );
  }

}
