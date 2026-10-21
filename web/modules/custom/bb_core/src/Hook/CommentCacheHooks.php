<?php

declare(strict_types=1);

namespace Drupal\bb_core\Hook;

use Drupal\Core\Cache\CacheTagsInvalidatorInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Hook\Attribute\Hook;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Invalidates the parent ticket's cache tag on bb_comment write operations.
 *
 * JSON:API caches the ticket resource keyed by `bb_ticket:{id}`. When a
 * comment is created or deleted the set of comments visible via
 * `?include=comments` changes, so the parent ticket's cache entry must be
 * invalidated immediately.
 */
final class CommentCacheHooks {

  public function __construct(
    #[Autowire(service: 'cache_tags.invalidator')]
    private readonly CacheTagsInvalidatorInterface $cacheTagsInvalidator,
  ) {
  }

  /**
   * Invalidates the parent ticket cache tag when a bb_comment is created.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity that was inserted.
   */
  #[Hook('entity_insert')]
  public function entityInsert(EntityInterface $entity): void {
    $this->invalidateTicketTag($entity);
  }

  /**
   * Invalidates the parent ticket cache tag when a bb_comment is updated.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity that was updated.
   */
  #[Hook('entity_update')]
  public function entityUpdate(EntityInterface $entity): void {
    $this->invalidateTicketTag($entity);
    $this->invalidateOnAssigneeChange($entity);
  }

  /**
   * Invalidates the parent ticket cache tag when a bb_comment is deleted.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity that was deleted.
   */
  #[Hook('entity_delete')]
  public function entityDelete(EntityInterface $entity): void {
    $this->invalidateTicketTag($entity);
  }

  /**
   * Invalidates `bb_ticket:{id}` for the comment's parent ticket.
   *
   * Silently returns if the entity is not a bb_comment or has no ticket_id.
   *
   * @param \Drupal\Core\Entity\EntityInterface $entity
   *   The entity being written or deleted.
   */
  private function invalidateTicketTag(EntityInterface $entity): void {
    if (!$entity instanceof BbCommentInterface) {
      return;
    }
    $ticketId = $entity->getTicketId();
    if ($ticketId === NULL) {
      return;
    }
    $this->cacheTagsInvalidator->invalidateTags(['bb_ticket:' . $ticketId]);
  }

  /**
   * Drops private review query results when decision authority moves.
   */
  private function invalidateOnAssigneeChange(EntityInterface $entity): void {
    if (!$entity instanceof BbTicketInterface) {
      return;
    }
    $original = $entity->getOriginal();
    if (!$original instanceof BbTicketInterface) {
      return;
    }
    if ((int) $original->get('assignee_user_id')->target_id === (int) $entity->get('assignee_user_id')->target_id) {
      return;
    }
    $this->cacheTagsInvalidator->invalidateTags([
      'bb_comment_list',
      'bb_ticket:' . $entity->id(),
    ]);
  }

}
