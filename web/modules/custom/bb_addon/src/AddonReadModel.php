<?php

declare(strict_types=1);

namespace Drupal\bb_addon;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * What a viewer sees of a ticket's addons: messages, and the newest one.
 *
 * `access_ok` tells whether the viewer holds the ticket operation the message
 * requires; both UIs hide messages without it.
 */
final class AddonReadModel {

  public function __construct(
    private readonly AddonRepository $repository,
  ) {}

  /**
   * The read model of a ticket for an account.
   *
   * @return array{conductor: array{status: string}|null, addons: array<int, array<string, mixed>>}
   *   The conductor's status and one entry per addon.
   */
  public function forTicket(BbTicketInterface $ticket, AccountInterface $account): array {
    $conductor = $ticket->getConductor();
    $addons = [];
    foreach ($this->repository->forTicket($ticket) as $addon) {
      $addons[] = $this->entry($ticket, $addon, $account);
    }
    return [
      'conductor' => $conductor === NULL ? NULL : ['status' => $conductor->getStatus()],
      'addons' => $addons,
    ];
  }

  /**
   * One addon's entry for a ticket and an account.
   *
   * @return array<string, mixed>
   *   The entry: id, name, version, contract, label, messages, latest.
   */
  public function entry(BbTicketInterface $ticket, BbAddonInterface $addon, AccountInterface $account): array {
    $definition = $addon->definition();
    $messages = [];
    foreach ($definition['messages'] ?? [] as $key => $msg) {
      $access = $msg['access'] ?? 'update';
      $messages[] = [
        'key' => (string) $key,
        'label' => $msg['label'],
        'input' => $msg['input'] ?? NULL,
        'access' => $access,
        'access_ok' => (bool) $ticket->access($access, $account),
      ];
    }
    // Personal, not shared (BB-661): the account's own newest request,
    // never another requester's.
    $message = $this->repository->latestMessageFor($ticket, $addon, $account);
    $key = $message === NULL ? NULL : substr($message->messageId(), strlen($addon->name()) + 1);
    $messageLabel = (string) ($definition['messages'][$key]['label'] ?? $key);
    return [
      'id' => (string) $addon->uuid(),
      'name' => $addon->name(),
      'version' => $addon->version(),
      'contract' => $addon->contract(),
      'label' => $addon->label(),
      'messages' => $messages,
      'latest' => $message === NULL ? NULL : [
        'id' => (string) $message->uuid(),
        'action' => $key,
        'label' => $messageLabel,
        'status' => $message->status(),
        'result' => $message->result(),
        'changed' => (int) $message->get('changed')->value,
        'created' => (int) $message->get('created')->value,
      ],
    ];
  }

}
