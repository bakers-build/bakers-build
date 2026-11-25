<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Gives ticket reads an ETag and answers a matching If-None-Match with 304.
 *
 * The ETag hashes the final body this request produced, after access and
 * serialization, so a 304 only answers a request whose own 200 would be
 * identical. It saves the transfer, not the server's work.
 */
final class TicketEtagSubscriber implements EventSubscriberInterface {

  /**
   * The ticket collection and individual routes.
   */
  private const ROUTES = ['jsonapi.bb_ticket--bb_ticket.collection', 'jsonapi.bb_ticket--bb_ticket.individual'];

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // After every subscriber that may still change the body (the client
    // version hint runs at -10).
    return [KernelEvents::RESPONSE => ['onResponse', -20]];
  }

  /**
   * Sets the ETag and turns an unchanged repeat into 304.
   */
  public function onResponse(ResponseEvent $event): void {
    $request = $event->getRequest();
    $response = $event->getResponse();
    if (!$event->isMainRequest() || !$request->isMethodCacheable() || $response->getStatusCode() !== 200
      || !in_array($request->attributes->get('_route'), self::ROUTES, TRUE)) {
      return;
    }
    $response->setEtag(hash('xxh128', (string) $response->getContent()));
    $response->isNotModified($request);
  }

}
