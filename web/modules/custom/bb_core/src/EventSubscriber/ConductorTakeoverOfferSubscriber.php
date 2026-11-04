<?php

declare(strict_types=1);

namespace Drupal\bb_core\EventSubscriber;

use Drupal\bb_core\Conductor\ConductorTakeoverOffer;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Answers a takeover offer with a JSON:API 409 carrying its candidates.
 *
 * A JSON:API resource must return a ResourceResponse, and JSON:API's own
 * error normalizer drops custom `meta`, so the offer is answered here.
 */
final class ConductorTakeoverOfferSubscriber implements EventSubscriberInterface {

  /**
   * Turns the offer into `errors[0].meta.candidates`.
   */
  public function onException(ExceptionEvent $event): void {
    $offer = $event->getThrowable();
    if (!$offer instanceof ConductorTakeoverOffer) {
      return;
    }
    $error = [
      'status' => '409',
      'title' => 'Conflict',
      'detail' => $offer->getMessage(),
      'meta' => ['candidates' => $offer->candidates],
    ];
    $event->setResponse(new JsonResponse(['errors' => [$error]], 409, ['Content-Type' => 'application/vnd.api+json']));
  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // Ahead of JSON:API's exception subscriber (priority 25).
    return [KernelEvents::EXCEPTION => ['onException', 50]];
  }

}
