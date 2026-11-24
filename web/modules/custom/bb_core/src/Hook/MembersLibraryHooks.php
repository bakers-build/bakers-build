<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Hook\Attribute\Hook;

/**
 * Puts the Members outcome behavior on every page.
 *
 * A last resort, with its reason: an island fragment response carries no
 * library tags, so a page entered by a tab or rail click never loads a
 * library its new island attaches. Without the behavior there, actions on
 * the Members face neither move focus nor announce their result.
 */
final class MembersLibraryHooks {

  /**
   * Implements hook_page_attachments().
   *
   * @param array<string, mixed> $attachments
   *   The page attachments.
   */
  #[Hook('page_attachments')]
  public function pageAttachments(array &$attachments): void {
    $attachments['#attached']['library'][] = 'bb_core/members';
  }

}
