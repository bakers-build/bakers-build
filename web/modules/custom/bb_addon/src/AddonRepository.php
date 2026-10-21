<?php

declare(strict_types=1);

namespace Drupal\bb_addon;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_addon\Entity\BbAddonInterface;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;

/**
 * Reads addons, their view state and their newest message.
 */
final class AddonRepository {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
  ) {}

  /**
   * Every row of an addon name within one workspace, newest first.
   *
   * Scoped by workspace (BB-660/661): the same name can exist as a
   * separate, unrelated registration in another workspace, and its metadata
   * or versions must never leak into this one.
   *
   * @return \Drupal\bb_addon\Entity\BbAddonInterface[]
   *   The rows, newest first.
   */
  public function rowsOf(string $name, int $workspace_id): array {
    $storage = $this->entityTypeManager->getStorage('bb_addon');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('name', $name)
      ->condition('workspace_id', $workspace_id)
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->execute();
    return array_values(array_filter(
      $storage->loadMultiple($ids),
      static fn ($addon): bool => $addon instanceof BbAddonInterface,
    ));
  }

  /**
   * The addons a conductor runs, newest version per name.
   *
   * Two rows of one name can list the same conductor during an upgrade
   * race; the most recently changed one wins.
   *
   * @return \Drupal\bb_addon\Entity\BbAddonInterface[]
   *   Keyed by name, ordered by name.
   */
  public function forConductor(BbConductorInterface $conductor): array {
    $storage = $this->entityTypeManager->getStorage('bb_addon');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('conductors', $conductor->id())
      ->sort('changed')
      ->sort('id')
      ->execute();
    $addons = [];
    foreach ($storage->loadMultiple($ids) as $addon) {
      if ($addon instanceof BbAddonInterface) {
        $addons[$addon->name()] = $addon;
      }
    }
    ksort($addons);
    return $addons;
  }

  /**
   * The addons of the ticket's conductor; none without a conductor.
   *
   * @return \Drupal\bb_addon\Entity\BbAddonInterface[]
   *   Keyed by name.
   */
  public function forTicket(BbTicketInterface $ticket): array {
    $conductor = $ticket->getConductor();
    return $conductor === NULL ? [] : $this->forConductor($conductor);
  }

  /**
   * The addon and action responsible for a message id on a conductor.
   *
   * @return array{0: \Drupal\bb_addon\Entity\BbAddonInterface, 1: string}|null
   *   The addon and the action key, NULL when nobody handles the id.
   */
  public function resolve(BbConductorInterface $conductor, string $message_id): ?array {
    if (!str_contains($message_id, '.')) {
      return NULL;
    }
    [$name, $key] = explode('.', $message_id, 2);
    $addon = $this->forConductor($conductor)[$name] ?? NULL;
    if ($addon === NULL) {
      return NULL;
    }
    $known = $addon->message($key) !== NULL;
    return $known ? [$addon, $key] : NULL;
  }

  /**
   * This requester's newest message for the addon in this ticket.
   *
   * Personal, not shared (BB-661 AC-3/AC-4): selected by `requested_by`,
   * ordered by `(created DESC, id DESC)`, spanning every message type and
   * every version, so a later response to an older request never displaces
   * this requester's own newest request. Never falls back to another
   * requester's message.
   */
  public function latestMessageFor(BbTicketInterface $ticket, BbAddonInterface $addon, AccountInterface $account): ?BbInboxMessageInterface {
    if ((int) $account->id() === 0) {
      return NULL;
    }
    $keys = array_keys($addon->definition()['messages'] ?? []);
    $ids = array_map(static fn (int|string $key) => $addon->name() . '.' . $key, $keys);
    if ($ids === []) {
      return NULL;
    }
    $storage = $this->entityTypeManager->getStorage('bb_inbox_message');
    $found = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('message_id', $ids, 'IN')
      ->condition('requested_by', $account->id())
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, 1)
      ->execute();
    $message = $found === [] ? NULL : $storage->load(reset($found));
    return $message instanceof BbInboxMessageInterface ? $message : NULL;
  }

  /**
   * This requester's messages for the ticket, newest first, paged.
   *
   * Optionally filtered to one addon name. `$before` is the request UUID to
   * page after (exclusive), not an authority — callers must already hold
   * ticket view access before calling this.
   *
   * @return \Drupal\bb_inbox\Entity\BbInboxMessageInterface[]
   *   Up to `$limit` messages.
   */
  public function historyFor(BbTicketInterface $ticket, AccountInterface $account, ?string $addon_name, ?string $before, int $limit): array {
    if ((int) $account->id() === 0) {
      return [];
    }
    $storage = $this->entityTypeManager->getStorage('bb_inbox_message');
    $query = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('requested_by', $account->id())
      ->sort('created', 'DESC')
      ->sort('id', 'DESC')
      ->range(0, $limit);
    if ($addon_name !== NULL) {
      $query->condition('message_id', $addon_name . '.', 'STARTS_WITH');
    }
    if ($before !== NULL) {
      $cursor = $storage->loadByProperties(['uuid' => $before]);
      $cursor = reset($cursor);
      if ($cursor instanceof BbInboxMessageInterface) {
        $query->condition('id', $cursor->id(), '<');
      }
    }
    return array_values(array_filter(
      $storage->loadMultiple($query->execute()),
      static fn ($m): bool => $m instanceof BbInboxMessageInterface,
    ));
  }

}
