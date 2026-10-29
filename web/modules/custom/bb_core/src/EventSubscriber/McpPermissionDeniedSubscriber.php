<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\Session\AccountInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Names the missing permission in mcp_server's bare "Forbidden" error.
 *
 * A signed-in account without `access mcp server` otherwise learns nothing
 * it could ask an administrator for.
 */
final class McpPermissionDeniedSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly RouteMatchInterface $routeMatch,
  ) {}

  /**
   * Rewrites the JSON-RPC error message of a permission denial.
   */
  public function onResponse(ResponseEvent $event): void {
    $response = $event->getResponse();
    if ($response->getStatusCode() !== 403
      || !$response instanceof JsonResponse
      || $this->routeMatch->getRouteName() !== 'mcp_server.handle'
      || $this->currentUser->hasPermission('access mcp server')) {
      return;
    }
    $body = json_decode((string) $response->getContent(), TRUE);
    if (!is_array($body) || !isset($body['error']['message'])) {
      return;
    }
    $body['error']['message'] = "Forbidden: this account lacks the 'access mcp server' permission.";
    $response->setData($body);
  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [KernelEvents::RESPONSE => 'onResponse'];
  }

}
