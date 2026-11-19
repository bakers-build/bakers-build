<?php

declare(strict_types=1);

namespace Drupal\bb_core\Members;

use Drupal\Core\Messenger\MessengerInterface;
use Drupal\Core\Template\Attribute;
use Drupal\bb_core\Form\WorkspaceInviteForm;
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

  /**
   * The result a finished dialog left for the Members face, once, as a toast.
   *
   * A toast like every other confirmation: fixed, so the list does not move,
   * and hidden again after a few seconds, as the status messages are.
   *
   * @return array<string, mixed>
   *   The toast with its text in `#bb_result`, or an uncacheable nothing.
   */
  public static function result(MessengerInterface $messenger): array {
    $messages = $messenger->messagesByType(WorkspaceInviteForm::RESULT_MESSAGE_TYPE);
    $build = ['#weight' => -5, '#cache' => ['max-age' => 0]];
    if ($messages === []) {
      return $build;
    }
    $text = implode(' ', array_map('strval', $messages));
    return $build + [
      '#bb_result' => $text,
      'message' => [
        '#type' => 'component',
        '#component' => 'bb_theme:toast',
        '#props' => [
          'message' => $text,
          'attributes' => new Attribute([
            'x-data' => '',
            'x-init' => 'setTimeout(() => { $el.hidden = true }, 5000)',
          ]),
        ],
      ],
    ];
  }

}
