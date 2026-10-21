<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Activity;

/**
 * The moments a kind can listen to, and the facts each one hands over.
 *
 * Every entity save is a trigger: `<entity type>:insert` with the fact
 * `entity`, `<entity type>:update` with `entity` and `original` (its stored
 * predecessor). A kind names its triggers in its attribute and declares the
 * facts it reads as contexts of the same name; record() returns NULL when
 * the facts are not its activity.
 */
final class ActivityTrigger {

  /**
   * A conductor claimed a ticket. Facts: `ticket`, `run`, `conductor`.
   */
  public const TICKET_CLAIMED = 'bb_core.ticket_claimed';

}
