<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\entity\EntityAccessControlHandler;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Allows scoped sessions to create comments and gates private reviews.
 *
 * Create is granted by the session-scope permission; the parent-ticket scope
 * is enforced by the BbSessionScope constraint on the comment's ticket_id
 * field (see BbComment::baseFieldDefinitions). Review publication and
 * decision rights are extra to that, and never follow ticket update access.
 */
final class BbCommentAccessControlHandler extends EntityAccessControlHandler {

  /**
   * Values clients must not author on a review.
   *
   * @var list<string>
   */
  private const SERVER_OWNED_FIELDS = [
    'status',
    'submitted_at',
    'decided_at',
    'decided_by',
    'author',
  ];

  /**
   * Grants create access to accounts with the session-scoped write permission.
   *
   * {@inheritdoc}
   */
  protected function checkCreateAccess(AccountInterface $account, array $context, $entity_bundle = NULL): AccessResultInterface {
    $result = parent::checkCreateAccess($account, $context, $entity_bundle);
    if (!$result->isAllowed() && $account->hasPermission('write bakers via session scope')) {
      return AccessResult::allowed()->cachePerPermissions();
    }
    if ($entity_bundle === 'review' && $account->isAuthenticated()
      && $account->hasPermission('view bb_comment')) {
      return AccessResult::allowed()
        ->cachePerPermissions()
        ->cachePerUser()
        ->orIf($result);
    }
    return $result;
  }

  /**
   * {@inheritdoc}
   */
  protected function checkAccess(EntityInterface $entity, $operation, AccountInterface $account): AccessResultInterface {
    if (!$entity instanceof BbCommentInterface || $entity->bundle() !== 'review') {
      return parent::checkAccess($entity, $operation, $account);
    }
    return match ($operation) {
      'view' => $this->reviewViewAccess($entity, $account),
      'update' => $this->reviewUpdateAccess($entity, $account),
      'delete' => $this->reviewDeleteAccess($entity, $account),
      default => parent::checkAccess($entity, $operation, $account),
    };
  }

  /**
   * {@inheritdoc}
   */
  protected function checkFieldAccess($operation, FieldDefinitionInterface $field_definition, AccountInterface $account, ?FieldItemListInterface $items = NULL): AccessResultInterface {
    if ($operation === 'edit' && in_array($field_definition->getName(), self::SERVER_OWNED_FIELDS, TRUE)) {
      $entity = $items?->getEntity();
      if ($entity instanceof BbCommentInterface && $entity->bundle() === 'review') {
        return AccessResult::forbidden('Review audit fields are server-owned.')
          ->cachePerPermissions();
      }
    }
    return parent::checkFieldAccess($operation, $field_definition, $account, $items);
  }

  /**
   * Published reviews follow ordinary comment view; private ones do not.
   */
  private function reviewViewAccess(BbCommentInterface $comment, AccountInterface $account): AccessResultInterface {
    if ($comment->isPublished()) {
      return parent::checkAccess($comment, 'view', $account);
    }
    $ticket = $comment->get('ticket_id')->entity;
    $result = AccessResult::forbidden()
      ->cachePerUser()
      ->addCacheableDependency($comment);
    if (!$ticket instanceof BbTicketInterface) {
      return $result;
    }
    $result->addCacheableDependency($ticket);
    $is_author = (int) $comment->getOwnerId() === (int) $account->id()
      && $account->hasPermission('view bb_comment');
    $state = (string) $comment->get('review_state')->value;
    $is_deciding_assignee = in_array($state, ['submitted', 'rejected'], TRUE)
      && (int) $ticket->get('assignee_user_id')->target_id === (int) $account->id();
    if (!$is_author && !$is_deciding_assignee) {
      return $result;
    }
    $ticket_view = $ticket->access('view', $account, TRUE);
    if (!$ticket_view->isAllowed()) {
      return $result->addCacheableDependency($ticket_view);
    }
    return AccessResult::allowed()
      ->cachePerUser()
      ->addCacheableDependency($ticket_view)
      ->addCacheableDependency($ticket)
      ->addCacheableDependency($comment);
  }

  /**
   * The narrow right an assignment gives: its author keeps their own draft.
   *
   * No general comment permission is needed, so a read-only guest who is an
   * assigned reviewer can edit and delete what they wrote.
   */
  private function assignedAuthorAccess(BbCommentInterface $comment, AccountInterface $account): AccessResultInterface {
    $ticket = $comment->get('ticket_id')->entity;
    $neutral = AccessResult::neutral()->cachePerUser()->addCacheableDependency($comment);
    if (!$ticket instanceof BbTicketInterface
      || (int) $comment->getOwnerId() !== (int) $account->id()
      || !in_array((string) $account->id(), array_column($ticket->get('reviewers')->getValue(), 'target_id'), FALSE)) {
      return $ticket instanceof BbTicketInterface ? $neutral->addCacheableDependency($ticket) : $neutral;
    }
    $view = $ticket->access('view', $account, TRUE);
    return AccessResult::allowedIf($view->isAllowed())
      ->cachePerUser()
      ->addCacheableDependency($view)
      ->addCacheableDependency($ticket)
      ->addCacheableDependency($comment);
  }

  /**
   * The author edits their own draft by assignment, permission or session.
   */
  private function ownDraftUpdateAccess(BbCommentInterface $comment, AccountInterface $account): AccessResultInterface {
    $assigned = $this->assignedAuthorAccess($comment, $account);
    if ($assigned->isAllowed()) {
      return $assigned;
    }
    $result = parent::checkAccess($comment, 'update', $account);
    if ($result->isAllowed() || !$account->hasPermission('write bakers via session scope')) {
      return $result;
    }
    return AccessResult::allowed()
      ->cachePerPermissions()
      ->cachePerUser()
      ->addCacheableDependency($comment);
  }

  /**
   * Draft authors may edit; current assignees may decide submitted reviews.
   */
  private function reviewUpdateAccess(BbCommentInterface $comment, AccountInterface $account): AccessResultInterface {
    $state = (string) $comment->get('review_state')->value;
    if ($state === 'draft' && (int) $comment->getOwnerId() === (int) $account->id()) {
      return $this->ownDraftUpdateAccess($comment, $account);
    }
    $ticket = $comment->get('ticket_id')->entity;
    $result = AccessResult::forbidden()
      ->cachePerUser()
      ->addCacheableDependency($comment);
    if ($ticket instanceof BbTicketInterface) {
      $result->addCacheableDependency($ticket);
    }
    if ($state !== 'submitted'
      || !$ticket instanceof BbTicketInterface
      || (int) $ticket->get('assignee_user_id')->target_id !== (int) $account->id()) {
      return $result;
    }
    $ticket_view = $ticket->access('view', $account, TRUE);
    if (!$ticket_view->isAllowed()) {
      return $result->addCacheableDependency($ticket_view);
    }
    return AccessResult::allowed()
      ->cachePerUser()
      ->addCacheableDependency($ticket_view)
      ->addCacheableDependency($ticket)
      ->addCacheableDependency($comment);
  }

  /**
   * Only unpublished drafts may be deleted, and only by their author.
   */
  private function reviewDeleteAccess(BbCommentInterface $comment, AccountInterface $account): AccessResultInterface {
    if ((string) $comment->get('review_state')->value === 'draft') {
      $assigned = $this->assignedAuthorAccess($comment, $account);
      return $assigned->isAllowed() ? $assigned : parent::checkAccess($comment, 'delete', $account);
    }
    return AccessResult::forbidden('Submitted reviews cannot be deleted.')
      ->cachePerUser()
      ->addCacheableDependency($comment);
  }

}
