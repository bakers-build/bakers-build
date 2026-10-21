<?php

declare(strict_types=1);

namespace Drupal\bb_addon\EventSubscriber;

use Drupal\bb_addon\AddonRepository;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_inbox\Event\InboxMessageEvent;
use Drupal\bb_inbox\MessageContractValidator;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Takes responsibility for `<addon>.<message>` messages.
 *
 * On create it applies the message's `access` (ticket view or update) and
 * validates the payload against its input. Results are validated by the inbox
 * itself (`message-result.v2`); claiming them is enough here.
 */
final class AddonInboxSubscriber implements EventSubscriberInterface {

  public function __construct(
    private readonly AddonRepository $repository,
    private readonly MessageContractValidator $validator,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [InboxMessageEvent::NAME => 'onMessage'];
  }

  /**
   * Claims, and on create checks access and validates the payload.
   */
  public function onMessage(InboxMessageEvent $event): void {
    $message = $event->message;
    $conductor = $message->conductor();
    $resolved = $conductor === NULL ? NULL : $this->repository->resolve($conductor, $message->messageId());
    if ($resolved === NULL) {
      return;
    }
    [$addon, $key] = $resolved;
    $event->claim('addon:' . $addon->name(), $addon->version());

    if ($event->op === InboxMessageEvent::OP_CREATE) {
      $this->validateCreate($event, $addon, $key);
    }
  }

  /**
   * Checks the operation's access and validates the payload against it.
   */
  private function validateCreate(InboxMessageEvent $event, BbAddonInterface $addon, string $key): void {
    $message = $event->message;
    $operation = $addon->message($key)['access'] ?? 'update';
    if (!$message->ticket()?->access($operation, $event->account)) {
      $event->deny("$operation access on the ticket is required for {$message->messageId()}");
    }
    $payload = json_decode((string) $message->get('payload')->value);
    $payload = is_object($payload) ? $payload : [];
    $errors = $this->validator->validateArgs($addon->message($key) ?? [], $payload);
    foreach ($errors as $error) {
      $event->veto("payload.$error");
    }
  }

}
