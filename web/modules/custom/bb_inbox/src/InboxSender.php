<?php

declare(strict_types=1);

namespace Drupal\bb_inbox;

use Drupal\Core\Access\AccessException;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\bb_inbox\Event\InboxMessageEvent;
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;

/**
 * Creates inbox messages; the one write path for people.
 */
final class InboxSender {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EventDispatcherInterface $dispatcher,
  ) {}

  /**
   * Sends a message about a ticket to the ticket's conductor.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket.
   * @param string $message_id
   *   The message id, e.g. `ports.up`.
   * @param array<string, mixed> $payload
   *   The payload.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The sender.
   *
   * @return \Drupal\bb_inbox\Entity\BbInboxMessageInterface
   *   The saved, pending message.
   *
   * @throws \Drupal\bb_inbox\InboxRejected
   *   No conductor, no handler, a veto or an invalid message (422).
   * @throws \Drupal\Core\Access\AccessException
   *   The responsible handler denied the sender (403).
   */
  public function send(BbTicketInterface $ticket, string $message_id, array $payload, AccountInterface $account): BbInboxMessageInterface {
    if ($ticket->getConductor() === NULL) {
      throw new InboxRejected(sprintf('Ticket %s has no conductor.', $ticket->getIdentifier()));
    }
    $message = $this->entityTypeManager->getStorage('bb_inbox_message')->create([
      'ticket_id' => $ticket->id(),
      'message_id' => $message_id,
      'payload' => json_encode((object) $payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
      'requested_by' => $account->id(),
    ]);
    assert($message instanceof BbInboxMessageInterface);
    $event = new InboxMessageEvent($message, InboxMessageEvent::OP_CREATE, $account);
    $this->dispatcher->dispatch($event, InboxMessageEvent::NAME);
    if (!$event->isClaimed()) {
      throw new InboxRejected("no handler for message $message_id");
    }
    if ($event->denied() !== NULL) {
      throw new AccessException($event->denied());
    }
    // The handler sees the sender through `requested_by`. The server-set
    // references are left out: the caller checked ticket view access itself,
    // and the reference check asks the read-scoped ticket query, which can
    // disagree with entity access (a workspace guest outside the ticket's
    // team may view it but not list it).
    $violations = [];
    $found = $message->validate();
    $found->filterByFields(['ticket_id', 'requested_by']);
    foreach ($found as $violation) {
      $violations[] = (string) $violation->getMessage();
    }
    if ($violations !== []) {
      throw new InboxRejected(implode('; ', $violations));
    }
    $message->save();
    return $message;
  }

}
