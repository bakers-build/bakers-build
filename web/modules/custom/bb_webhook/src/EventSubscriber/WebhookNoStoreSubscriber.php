<?php

declare(strict_types=1);

namespace Drupal\bb_webhook\EventSubscriber;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Keeps the add form's response, which shows the secret once, out of caches.
 *
 * As ApiKeyNoStoreSubscriber: after FinishResponseSubscriber, which would
 * rewrite a header set from a render attachment.
 */
final class WebhookNoStoreSubscriber implements EventSubscriberInterface {

  /**
   * The add routes, one per scope.
   *
   * @var array<int, string>
   */
  private const array SECRET_ROUTES = [
    'entity.bb_webhook.add_for_project',
    'entity.bb_webhook.add_for_group',
    'entity.bb_webhook.add_for_workspace',
  ];

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [KernelEvents::RESPONSE => ['onResponse', -100]];
  }

  /**
   * Sets no-store on every add route.
   */
  public function onResponse(ResponseEvent $event): void {
    if (in_array($event->getRequest()->attributes->get('_route'), self::SECRET_ROUTES, TRUE)) {
      $event->getResponse()->headers->set('Cache-Control', 'private, no-store, max-age=0');
    }
  }

}
