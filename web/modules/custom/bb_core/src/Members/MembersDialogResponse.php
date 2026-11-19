<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Symfony\Component\HttpFoundation\Response;

/**
 * Closes a Members dialog and has the members island re-render in place.
 *
 * No page load, so the list stays where it was. The island subscribes to
 * EVENT (`MembersIslandPlacementTrait`), and `island.events.js` refreshes it;
 * the refreshed face then shows the result and moves focus.
 */
final class MembersDialogResponse {

  /**
   * The island event a finished Members dialog announces.
   */
  public const string EVENT = 'bakers.members.changed';

  /**
   * The empty answer that deletes the dialog and announces EVENT.
   */
  public static function close(): Response {
    return new Response('', 200, [
      'Content-Type' => 'text/html; charset=UTF-8',
      'HX-Retarget' => 'closest [data-dialog]',
      'HX-Reswap' => 'delete',
      'HX-Trigger' => self::EVENT,
    ]);
  }

}
