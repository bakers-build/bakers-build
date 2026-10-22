<?php

declare(strict_types=1);

namespace Drupal\bb_oauth_device\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Flood\FloodInterface;
use Drupal\consumers\Entity\Consumer;
use Drupal\simple_oauth\Entities\ClientEntityInterface;
use Drupal\simple_oauth\Plugin\Field\FieldType\Oauth2ScopeReferenceItemListInterface;
use Drupal\simple_oauth\Server\AuthorizationServerFactoryInterface;
use GuzzleHttp\Psr7\Response;
use League\OAuth2\Server\Exception\OAuthServerException;
use League\OAuth2\Server\Repositories\ClientRepositoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Log\LogLevel;
use Psr\Log\LoggerInterface;
use Symfony\Bridge\PsrHttpMessage\HttpMessageFactoryInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Serves RFC 8628 §3.1 device authorization requests.
 */
class DeviceAuthorizationController extends ControllerBase {

  /**
   * Flood-control event name and window.
   *
   * The route is anonymous by design; a generous per-caller limit bounds
   * the write amplification of anyone who knows a public client_id. Keyed on
   * client_id and IP so a stranger cannot drain one site-wide allowance.
   */
  protected const FLOOD_EVENT = 'bb_oauth_device.authorize';
  protected const FLOOD_LIMIT = 60;
  protected const FLOOD_WINDOW_SECONDS = 300;

  public function __construct(
    protected AuthorizationServerFactoryInterface $authorizationServerFactory,
    protected HttpMessageFactoryInterface $httpMessageFactory,
    protected ClientRepositoryInterface $clientRepository,
    protected LoggerInterface $logger,
    protected FloodInterface $flood,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('simple_oauth.server.authorization_server.factory'),
      $container->get('psr7.http_message_factory'),
      $container->get('simple_oauth.repositories.client'),
      $container->get('logger.channel.simple_oauth'),
      $container->get('flood'),
    );
  }

  /**
   * Issues a device code and a user code for a public client.
   */
  public function authorize(Request $request): ResponseInterface {
    $server_request = $this->httpMessageFactory->createRequest($request);
    $server_response = new Response();

    try {
      // The CLI sends client_id in the form-encoded body and no client
      // authentication at all: this is a public client secured by the human's
      // confirmation on the verification route.
      $client_id = (string) $request->request->get('client_id', '');
      if ($client_id === '') {
        throw OAuthServerException::invalidRequest('client_id');
      }

      $this->enforceFlood($client_id, $request->getClientIp());

      $client_entity = $this->clientRepository->getClientEntity($client_id);
      if (!$client_entity instanceof ClientEntityInterface) {
        throw OAuthServerException::invalidClient($server_request);
      }

      $consumer = $client_entity->getDrupalEntity();
      $server = $this->authorizationServerFactory->get($consumer);
      $server_request = $this->applyScope($server_request, $consumer, (string) $request->request->get('scope', ''));

      return $server->respondToDeviceAuthorizationRequest($server_request, $server_response);
    }
    catch (OAuthServerException $exception) {
      $this->logger->log(
        $exception->getCode() < 500 ? LogLevel::NOTICE : LogLevel::ERROR,
        $exception->getMessage() . ' Hint: ' . $exception->getHint() . '.'
      );

      $response = $exception->generateHttpResponse($server_response);
      if ($exception->getHttpStatusCode() === 429) {
        // generateHttpResponse() adds no Retry-After; RFC 6585 §4 says a 429
        // SHOULD send one.
        $response = $response->withHeader('Retry-After', (string) self::FLOOD_WINDOW_SECONDS);
      }

      return $response;
    }
  }

  /**
   * Rejects a request over the per-caller flood limit, else registers it.
   *
   * Keyed on client_id and the requester's IP; see FLOOD_EVENT.
   */
  protected function enforceFlood(string $client_id, ?string $client_ip): void {
    $flood_identifier = $client_id . ':' . $client_ip;
    if (!$this->flood->isAllowed(self::FLOOD_EVENT, self::FLOOD_LIMIT, self::FLOOD_WINDOW_SECONDS, $flood_identifier)) {
      // Not access_denied (the CLI treats it as terminal) and not slow_down
      // (token endpoint only): RFC 6749 §5.2 has no rate-limit code, so
      // invalid_request with a hint, at HTTP 429.
      $exception = new OAuthServerException(
        'Too many device authorization requests. Try again later.',
        429,
        'invalid_request',
        429,
        'Too many device authorization requests for this client. Retry after the window elapses.',
      );
      throw $exception;
    }
    $this->flood->register(self::FLOOD_EVENT, self::FLOOD_WINDOW_SECONDS, $flood_identifier);
  }

  /**
   * Resolves the request's scope against the consumer's own scopes.
   *
   * The simple_oauth module neither applies a consumer default nor restricts a
   * named scope on the device_code path, and a grant-level default scope is
   * overwritten by the server. So the default is injected as the request's
   * own `scope` parameter and a named scope is checked against the consumer.
   */
  protected function applyScope(
    ServerRequestInterface $server_request,
    Consumer $consumer,
    string $requested_scope,
  ): ServerRequestInterface {
    if ($requested_scope === '') {
      $default_scope = $this->defaultScope($consumer);
      if ($default_scope === NULL) {
        return $server_request;
      }
      return $server_request->withParsedBody(['scope' => $default_scope] + (array) $server_request->getParsedBody());
    }

    $consumer_scopes = $this->consumerScopeNames($consumer);
    foreach (preg_split('/\s+/', trim($requested_scope)) ?: [] as $scope_name) {
      if ($scope_name !== '' && !in_array($scope_name, $consumer_scopes, TRUE)) {
        throw OAuthServerException::invalidScope($scope_name);
      }
    }

    return $server_request;
  }

  /**
   * The consumer's own declared scopes, space-joined as league expects.
   */
  protected function defaultScope(Consumer $client): ?string {
    $names = $this->consumerScopeNames($client);
    return $names ? implode(' ', $names) : NULL;
  }

  /**
   * The consumer's own declared scope names.
   */
  protected function consumerScopeNames(Consumer $client): array {
    $scopes_field = $client->get('scopes');
    if (!$scopes_field instanceof Oauth2ScopeReferenceItemListInterface || $scopes_field->isEmpty()) {
      return [];
    }

    $names = [];
    foreach ($scopes_field->getScopes() as $scope) {
      $names[] = $scope->getName();
    }

    return $names;
  }

}
