<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_inbox\Kernel;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\Tests\bb_core\Kernel\WorkspaceReadScopeTestTrait;
use Drupal\user\UserInterface;

/**
 * A workspace world with a conductor-assigned ticket and the inbox actors.
 *
 * Side `a` holds the ticket under test, assigned to a conductor owned by a
 * dedicated account; side `b` provides the outsider.
 */
trait InboxWorldTrait {

  use WorkspaceReadScopeTestTrait;

  /**
   * Owner of the conductor the side-a ticket is assigned to.
   */
  protected UserInterface $conductorOwner;

  /**
   * The conductor the side-a ticket is assigned to.
   */
  protected BbConductorInterface $conductor;

  /**
   * The side-a ticket, assigned to $conductor.
   */
  protected BbTicketInterface $ticket;

  /**
   * Workspace-a guest: ticket view, no update.
   */
  protected UserInterface $guest;

  /**
   * Workspace-a contributor: ticket view and update.
   */
  protected UserInterface $contributor;

  /**
   * Workspace-b guest: cannot see the side-a ticket.
   */
  protected UserInterface $outsider;

  /**
   * Builds the world. Call from setUp() after parent::setUp().
   */
  protected function buildInboxWorld(): void {
    $this->installReadScopeEnvironment();
    $this->installEntitySchema('bb_inbox_message');
    $this->buildTwoWorkspaceWorld();

    $this->conductorOwner = $this->createAccount('conductor-owner', ['register bakers conductor', 'claim bakers tickets']);
    $this->workspaceMember('a', $this->conductorOwner, 'contributor');
    $this->conductor = $this->createConductor('node-inbox', $this->conductorOwner);
    $ticket = $this->fixture('a', 'bb_ticket');
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->set('conductor_id', $this->conductor->id())->save();
    $this->ticket = $ticket;

    $this->guest = $this->workspaceMember('a', $this->member('a'), 'guest');
    $this->contributor = $this->workspaceMember('a', $this->createAccount('contributor-a'), 'contributor');
    $this->outsider = $this->workspaceMember('b', $this->member('b'), 'guest');
  }

  /**
   * Makes the account a workspace member with a rank, and a team member.
   */
  protected function workspaceMember(string $side, UserInterface $account, string $rank): UserInterface {
    $this->addMembership($this->fixture($side, 'bb_workspace'), $account, [$rank]);
    $this->addMembership($this->fixture($side, 'bb_team'), $account, []);
    return $account;
  }

  /**
   * Creates a conductor on the side-a project owned by the given account.
   */
  protected function createConductor(string $id, UserInterface $owner): BbConductorInterface {
    $conductor = $this->createEntity('bb_conductor', [
      'conductor_id' => $id,
      'label' => $id,
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'owner_user_id' => $owner->id(),
      'status' => 'online',
    ]);
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    return $conductor;
  }

  /**
   * Sends a message as the given account through the sender service.
   *
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The sender.
   * @param string $message_id
   *   The message id.
   * @param array<string, mixed> $payload
   *   The payload.
   * @param \Drupal\bb_core\Entity\BbTicketInterface|null $ticket
   *   The ticket; defaults to the side-a ticket.
   */
  protected function send(AccountInterface $account, string $message_id, array $payload = [], ?BbTicketInterface $ticket = NULL): BbInboxMessageInterface {
    return $this->container->get('bb_inbox.sender')
      ->send($ticket ?? $this->ticket, $message_id, $payload, $account);
  }

  /**
   * Writes a status/result as the given account; returns violation messages.
   *
   * Saves only when there are no violations.
   *
   * @param \Drupal\bb_inbox\Entity\BbInboxMessageInterface $message
   *   The message.
   * @param string $status
   *   The new status.
   * @param array<string, mixed>|null $result
   *   The result, or NULL.
   * @param \Drupal\Core\Session\AccountInterface|null $account
   *   The writer; defaults to the conductor owner.
   *
   * @return array<string>
   *   The violation messages.
   */
  protected function writeResult(BbInboxMessageInterface $message, string $status, ?array $result, ?AccountInterface $account = NULL): array {
    $switcher = $this->container->get('account_switcher');
    $switcher->switchTo($account ?? $this->conductorOwner);
    try {
      $message->setResult($status, $result);
      $messages = [];
      foreach ($message->validate() as $violation) {
        $messages[] = (string) $violation->getMessage();
      }
      if ($messages === []) {
        $message->save();
      }
      return $messages;
    }
    finally {
      $switcher->switchBack();
    }
  }

  /**
   * Reloads a message from storage.
   */
  protected function reloadMessage(BbInboxMessageInterface $message): BbInboxMessageInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_inbox_message');
    $storage->resetCache([$message->id()]);
    $fresh = $storage->load($message->id());
    self::assertInstanceOf(BbInboxMessageInterface::class, $fresh);
    return $fresh;
  }

}
