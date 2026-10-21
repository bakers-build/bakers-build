<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Field\EntityReferenceFieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Computes the handoff stream of a ticket: every comment except the summaries.
 *
 * Same shape as CommentsItemList — bb_comment.ticket_id stays the single
 * source of truth and the list is read-only — narrowed to the comments whose
 * `type` (the `bb_comment_type` attribute over JSON:API) is not `summary`,
 * oldest first. The split exists because a field formatter renders every
 * referenced entity and has no predicate: filtering here is what keeps the
 * ticket_detail full display pure config.
 */
final class HandoffCommentsItemList extends EntityReferenceFieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew()) {
      return;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $query = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('status', 1);
    // "NOT summary" HAS TO INCLUDE "NO TYPE AT ALL". A bare
    // `condition('type', 'summary', '<>')` compiles to SQL `<>`, and SQL's
    // three-valued logic makes `NULL <> 'summary'` UNKNOWN rather than TRUE —
    // so a typeless comment would silently drop OUT of the handoff stream
    // instead of appearing in it. It cannot bite today, because `type` is
    // required and defaults to `comment`; it is written this way because the
    // stream is this screen's catch-all for "everything that is not a summary",
    // and a row that fell out of a catch-all leaves nothing behind to notice.
    $ids = $query
      ->condition($query->orConditionGroup()
        ->condition('type', 'summary', '<>')
        ->notExists('type'))
      ->sort('created', 'ASC')
      ->sort('id', 'ASC')
      ->execute();
    $delta = 0;
    foreach ($ids as $id) {
      $this->list[$delta] = $this->createItem($delta, ['target_id' => $id]);
      $delta++;
    }
  }

}
