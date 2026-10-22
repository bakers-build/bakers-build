<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Composer\Semver\Comparator;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\PageCache\ResponsePolicy\KillSwitch;
use Drupal\Core\Session\SessionConfigurationInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * The client-version contract between the server and the bakers CLI.
 *
 * Every bakers CLI request carries `X-Bakers-Client: bakers/<semver>`. Claims
 * require it at `min_client_version` or newer, so an incompatible client never
 * processes work. Other API errors without it gain an install hint, which is
 * what an old, differently named client shows its user. This is a
 * compatibility check, not a security boundary: a forged header grants nothing.
 */
final class ClientVersionSubscriber implements EventSubscriberInterface {

  public const HEADER = 'X-Bakers-Client';

  public const INSTALL_HINT = 'This server requires the bakers CLI (X-Bakers-Client header missing). Install it: npm install -g @bakers-build/bakers';

  private const CLAIM_ROUTES = ['bb_core.claim_next', 'bb_core.ticket_claim'];

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
    private readonly SessionConfigurationInterface $sessionConfiguration,
    private readonly KillSwitch $pageCacheKillSwitch,
  ) {}

  /**
   * Refuses a claim from a missing or too old client with 426.
   */
  public function onRequest(RequestEvent $event): void {
    $request = $event->getRequest();
    if (!in_array($request->attributes->get('_route'), self::CLAIM_ROUTES, TRUE)) {
      return;
    }
    $version = $this->versionOf($request);
    if ($version === NULL) {
      $event->setResponse($this->upgradeRequired(self::INSTALL_HINT));
      return;
    }
    $minimum = (string) $this->configFactory->get('bb_core.settings')->get('min_client_version');
    try {
      $tooOld = Comparator::lessThan($version, $minimum);
    }
    catch (\UnexpectedValueException) {
      $tooOld = TRUE;
    }
    if ($tooOld) {
      $event->setResponse($this->upgradeRequired(sprintf(
        'bakers %s is too old for this server (requires >= %s). Update: npm install -g @bakers-build/bakers@latest',
        $version,
        $minimum,
      )));
    }
  }

  /**
   * Adds the install hint to an API error answered to a header-less client.
   */
  public function onResponse(ResponseEvent $event): void {
    $request = $event->getRequest();
    $response = $event->getResponse();
    $path = $request->getPathInfo();
    // shortcut: assumes the default `/jsonapi` prefix, which this project
    // never changes; inject the JSON:API base path if it ever does.
    $api = str_starts_with($path, '/jsonapi/') || $path === '/oauth/token';
    if (!$api || !$response->isClientError() || $request->headers->has(self::HEADER)
      || $this->sessionConfiguration->hasSession($request)) {
      return;
    }
    $body = json_decode((string) $response->getContent(), TRUE);
    if (!is_array($body)) {
      // An unknown resource type reaches the site's HTML 404 page; an API
      // client can read neither that page nor a hint inside it.
      $body = ['errors' => []];
      $response->headers->set('Content-Type', 'application/vnd.api+json');
    }
    $body = $this->withHint($body, $response->getStatusCode());
    $response->setContent((string) json_encode($body, JSON_UNESCAPED_SLASHES));
    // The hinted body is for this client only; keep it out of the page cache.
    $this->pageCacheKillSwitch->trigger();
  }

  /**
   * An error body with the install hint added.
   *
   * @param array<string, mixed> $body
   *   The decoded response body.
   * @param int $status
   *   The response status code.
   *
   * @return array<string, mixed>
   *   The body with the hint: an extra JSON:API error, or an OAuth
   *   error_description suffix.
   */
  private function withHint(array $body, int $status): array {
    if (isset($body['error']) && !isset($body['errors'])) {
      $description = trim(($body['error_description'] ?? '') . ' ' . self::INSTALL_HINT);
      return ['error_description' => $description] + $body;
    }
    $body['errors'] = is_array($body['errors'] ?? NULL) ? $body['errors'] : [];
    $body['errors'][] = [
      'status' => (string) $status,
      'title' => 'bakers CLI required',
      'detail' => self::INSTALL_HINT,
    ];
    return $body;
  }

  /**
   * The semver a bakers client announced, or NULL without a bakers header.
   */
  private function versionOf(Request $request): ?string {
    $value = (string) $request->headers->get(self::HEADER, '');
    return str_starts_with($value, 'bakers/') ? substr($value, 7) : NULL;
  }

  /**
   * A JSON:API error document with status 426.
   */
  private function upgradeRequired(string $detail): JsonResponse {
    return new JsonResponse(
      ['errors' => [['status' => '426', 'title' => 'Upgrade Required', 'detail' => $detail]]],
      426,
      ['Content-Type' => 'application/vnd.api+json'],
    );
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, array{string, int}>
   *   The subscribed events.
   */
  public static function getSubscribedEvents(): array {
    // Requests: after routing (32), before the access check (8).
    // Responses: after JSON:API has serialized its error documents.
    return [
      KernelEvents::REQUEST => ['onRequest', 30],
      KernelEvents::RESPONSE => ['onResponse', -10],
    ];
  }

}
