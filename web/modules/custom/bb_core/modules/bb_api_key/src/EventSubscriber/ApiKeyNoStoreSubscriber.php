<?php

declare(strict_types=1);

namespace Drupal\bb_api_key\EventSubscriber;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Marks every create-API-key/service-account response `no-store`.
 *
 * The creating POST's response carries a one-time secret. A render
 * attachment cannot set this header: core's FinishResponseSubscriber rewrites
 * Cache-Control afterwards, so this runs after it.
 */
final class ApiKeyNoStoreSubscriber implements EventSubscriberInterface {

  /**
   * Routes whose response may carry a one-time secret.
   *
   * @var array<int, string>
   */
  private const array SECRET_ROUTES = [
    'bb_api_key.add',
    'bb_api_key.service_account.add',
    'bb_api_key.service_account.key_add',
  ];

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [KernelEvents::RESPONSE => ['onResponse', -100]];
  }

  /**
   * Overrides Cache-Control on every secret-producing route.
   */
  public function onResponse(ResponseEvent $event): void {
    if (!in_array($event->getRequest()->attributes->get('_route'), self::SECRET_ROUTES, TRUE)) {
      return;
    }
    $event->getResponse()->headers->set('Cache-Control', 'private, no-store, max-age=0');
  }

}
