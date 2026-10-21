<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\simple_oauth_server_metadata\Event\ResourceMetadataEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Points RFC 9728 protected-resource metadata at `/mcp`, not the site root.
 *
 * BB-658 review F5/F1: `ResourceMetadataService::getResourceMetadata()`
 * names `resource` from `EndpointDiscoveryService::getIssuer()`, which is the
 * site's base URL — correct for the authorization server, wrong for the
 * protected resource the MCP connector actually guards. Also names the one
 * bakers.build scope so a client reading this document, not just the authorize
 * request, knows what to ask for.
 */
final class McpResourceMetadataSubscriber implements EventSubscriberInterface {

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // BB-658 review N3: the string literal, not
    // ResourceMetadataEvents::BUILD. simple_oauth_server_metadata is only
    // enabled via config:import on an existing site, so its class is not yet
    // in Composer's autoload when this subscriber's own module is enabled;
    // referencing the constant would fatal with "class not found" on that
    // path even though kernel tests (which enable both modules together)
    // never see it.
    return [
      'simple_oauth_server_metadata.resource_metadata.build' => 'onResourceMetadata',
    ];
  }

  /**
   * Narrows the advertised resource to the MCP endpoint and names its scope.
   */
  public function onResourceMetadata(ResourceMetadataEvent $event): void {
    $issuer = rtrim((string) ($event->metadata['resource'] ?? ''), '/');
    $event->metadata['resource'] = $issuer . '/mcp';
    $event->metadata['scopes_supported'] = ['bb:session'];
  }

}
