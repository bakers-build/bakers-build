<?php

declare(strict_types=1);

namespace Drupal\bb_activity\Hook;

use Drupal\Core\Hook\Attribute\Hook;

/**
 * Builds the activity mail the mailer sends; the kinds send it themselves.
 */
final class ActivityMailHooks {

  /**
   * Implements hook_mail().
   *
   * @param string $key
   *   The mail key; only `activity` is handled.
   * @param array<string, mixed> $message
   *   The message to build.
   * @param array<string, mixed> $params
   *   Subject, body and links, already in the recipient's language.
   */
  #[Hook('mail')]
  public function mail(string $key, array &$message, array $params): void {
    if ($key !== 'activity') {
      return;
    }
    $message['subject'] = $params['subject'];
    $message['body'] = $params['body'];
    // The body carries ticket titles and kind text: only these are links.
    $message['bb_links'] = $params['links'];
  }

}
