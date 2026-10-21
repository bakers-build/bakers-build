<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Entity;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * One account's activity mail choices.
 */
interface NotificationSettingInterface extends ContentEntityInterface, EntityOwnerInterface {

  /**
   * The ticked message IDs, `kind.key`, in stored order.
   *
   * May hold the ID of a message whose kind is gone; readers ignore it.
   *
   * @return list<string>
   *   Message IDs.
   */
  public function ticked(): array;

}
