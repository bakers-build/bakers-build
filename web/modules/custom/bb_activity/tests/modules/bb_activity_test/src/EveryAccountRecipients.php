<?php

declare(strict_types=1);

namespace Drupal\bb_activity_test;

use Drupal\bb_activity\Entity\BbActivity;

/**
 * Names every account, so only the mailer's own rules narrow a test mail.
 */
trait EveryAccountRecipients {

  /**
   * {@inheritdoc}
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function recipients(BbActivity $activity): array {
    $uids = $this->entityTypeManager->getStorage('user')->getQuery()
      ->accessCheck(FALSE)
      ->condition('uid', 0, '>')
      ->execute();
    return array_map('intval', array_values($uids));
  }

}
