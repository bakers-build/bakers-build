<?php

declare(strict_types=1);

namespace Drupal\bb_inbox_test;

use Drupal\bb_inbox\Event\InboxMessageEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Responsible for `test.echo`; denies or vetoes on flags or a `bad` answer.
 */
final class EchoHandler implements EventSubscriberInterface {

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [InboxMessageEvent::NAME => 'onMessage'];
  }

  /**
   * Claims `test.echo` and applies the flag-driven outcomes.
   */
  public function onMessage(InboxMessageEvent $event): void {
    if ($event->message->messageId() !== 'test.echo') {
      return;
    }
    $event->claim('test', '0.0.1');
    if ($event->op === InboxMessageEvent::OP_CREATE) {
      $payload = $event->message->payload();
      if (!empty($payload['deny'])) {
        $event->deny('payload.deny');
      }
      if (!empty($payload['bad'])) {
        $event->veto('payload.bad');
      }
      return;
    }
    if (($event->message->result()['markdown'] ?? NULL) === 'bad') {
      $event->veto('result.bad');
    }
  }

}
