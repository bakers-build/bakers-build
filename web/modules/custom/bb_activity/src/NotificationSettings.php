<?php

declare(strict_types=1);

namespace Drupal\bb_activity;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\bb_activity\Activity\ActivityKindManager;
use Drupal\bb_activity\Entity\NotificationSettingInterface;

/**
 * Reads and keeps the one settings row of each account.
 */
final class NotificationSettings {

  /**
   * Constructs the row service.
   */
  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ActivityKindManager $kinds,
  ) {}

  /**
   * The account's row, if it has one.
   */
  public function forUser(int $uid): ?NotificationSettingInterface {
    if ($uid <= 0) {
      return NULL;
    }
    $rows = $this->storage()->loadByProperties(['user_id' => $uid]);
    $row = reset($rows);
    return $row instanceof NotificationSettingInterface ? $row : NULL;
  }

  /**
   * An unsaved row holding the kinds' default mails, for the settings page.
   */
  public function create(int $uid): NotificationSettingInterface {
    $row = $this->storage()->create([
      'user_id' => $uid,
      'messages' => $this->kinds->mailDefaults(),
    ]);
    assert($row instanceof NotificationSettingInterface);
    return $row;
  }

  /**
   * The account's row, created with the defaults when missing.
   */
  public function ensure(int $uid): NotificationSettingInterface {
    $row = $this->forUser($uid);
    if ($row !== NULL) {
      return $row;
    }
    if ($uid <= 0) {
      throw new \InvalidArgumentException('Notification settings belong to a real account.');
    }
    $row = $this->create($uid);
    try {
      $row->save();
    }
    catch (EntityStorageException $e) {
      // A concurrent request created it first; the unique key refused ours.
      return $this->forUser($uid) ?? throw $e;
    }
    return $row;
  }

  /**
   * The accounts that want one mail.
   *
   * An account that saved its choices wants what it ticked. An account that
   * never saved them has no row and wants the kinds' defaults (`mail_default`).
   *
   * @param string $message_id
   *   The message ID, the kind ID.
   *
   * @return list<int>
   *   Account IDs; the mailer still drops blocked and unreachable accounts.
   */
  public function subscribers(string $message_id): array {
    $owners = [];
    $ticked = [];
    foreach ($this->storage()->loadMultiple() as $row) {
      if ($row instanceof NotificationSettingInterface) {
        $owners[] = (int) $row->getOwnerId();
        if (in_array($message_id, $row->ticked(), TRUE)) {
          $ticked[] = (int) $row->getOwnerId();
        }
      }
    }
    if (!in_array($message_id, $this->kinds->mailDefaults(), TRUE)) {
      return $ticked;
    }
    // shortcut: loads every row and account ID per default mail; page through
    // them once a site has more accounts than one request can hold.
    $query = $this->entityTypeManager->getStorage('user')->getQuery()
      ->accessCheck(FALSE)
      ->condition('uid', 0, '>')
      ->condition('status', 1);
    if ($owners !== []) {
      $query->condition('uid', $owners, 'NOT IN');
    }
    return [...$ticked, ...array_map('intval', array_values($query->execute()))];
  }

  /**
   * The row storage.
   */
  private function storage(): EntityStorageInterface {
    return $this->entityTypeManager->getStorage('bb_notification_setting');
  }

}
