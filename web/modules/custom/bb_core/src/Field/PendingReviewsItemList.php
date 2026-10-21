<?php

declare(strict_types=1);

namespace Drupal\bb_core\Field;

use Drupal\Core\Cache\Cache;
use Drupal\Core\Field\EntityReferenceFieldItemList;
use Drupal\Core\TypedData\ComputedItemListTrait;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Submitted reviews awaiting a decision by the current assignee.
 *
 * Scoped to the current user: only the ticket's current assignee receives
 * ids, and only `review` comments in `submitted`. Drafts, accepted, rejected
 * and legacy comments stay out. accessCheck is FALSE because workspace query
 * access would empty the list in kernel installs; the assignee gate is the
 * leak protection, and entity access still applies when the ids are viewed.
 */
final class PendingReviewsItemList extends EntityReferenceFieldItemList {

  use ComputedItemListTrait;

  /**
   * {@inheritdoc}
   */
  protected function computeValue(): void {
    $ticket = $this->getEntity();
    if (!$ticket instanceof BbTicketInterface || $ticket->isNew()) {
      return;
    }
    $uid = (int) \Drupal::currentUser()->id();
    if ($uid === 0 || (int) $ticket->get('assignee_user_id')->target_id !== $uid) {
      return;
    }
    $storage = \Drupal::entityTypeManager()->getStorage('bb_comment');
    $ids = $storage->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('bundle', 'review')
      ->condition('review_state', 'submitted')
      ->sort('submitted_at', 'ASC')
      ->sort('id', 'ASC')
      ->execute();
    $delta = 0;
    foreach ($ids as $id) {
      $this->list[$delta] = $this->createItem($delta, ['target_id' => $id]);
      $delta++;
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    return Cache::mergeContexts($this->getEntity()->getCacheContexts(), ['user']);
  }

}
