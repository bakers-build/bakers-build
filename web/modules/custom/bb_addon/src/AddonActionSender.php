<?php

declare(strict_types=1);

namespace Drupal\bb_addon;

use Drupal\Core\Access\AccessException;
use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\InboxRejected;
use Drupal\bb_inbox\InboxSender;

/**
 * Sends an addon action from the web UI; refusals become messages.
 */
final class AddonActionSender {

  public function __construct(
    private readonly InboxSender $sender,
    private readonly MessengerInterface $messenger,
  ) {}

  /**
   * Sends `<addon>.<action>` about the ticket as the account.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param \Drupal\bb_addon\Entity\BbAddonInterface $addon
   *   The addon.
   * @param string $key
   *   The action key.
   * @param array<string, mixed> $args
   *   The payload.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The sender.
   */
  public function send(BbTicketInterface $ticket, BbAddonInterface $addon, string $key, array $args, AccountInterface $account): void {
    try {
      $this->sender->send($ticket, $addon->name() . '.' . $key, $args, $account);
    }
    catch (InboxRejected | AccessException $e) {
      $this->messenger->addError($e->getMessage());
    }
  }

}
