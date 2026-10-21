<?php

declare(strict_types=1);

namespace Drupal\bb_core\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Workflow\ReviewTransitionHandler;

/**
 * Route access for review draft and decision forms.
 */
final class ReviewCommentFormAccess {

  /**
   * Constructs a ReviewCommentFormAccess.
   */
  public function __construct(
    private readonly ReviewTransitionHandler $handler,
  ) {
  }

  /**
   * Assigned reviewers with ticket view may open the add-review form.
   */
  public function add(BbTicketInterface $bb_ticket, AccountInterface $account): AccessResultInterface {
    $result = AccessResult::forbidden()
      ->cachePerUser()
      ->addCacheableDependency($bb_ticket);
    $view = $bb_ticket->access('view', $account, TRUE);
    $result->addCacheableDependency($view);
    if (!$view->isAllowed()) {
      return $result;
    }
    if (!$this->handler->isAssignedReviewer($bb_ticket, $account)) {
      return $result;
    }
    return AccessResult::allowed()
      ->cachePerUser()
      ->addCacheableDependency($bb_ticket)
      ->addCacheableDependency($view);
  }

  /**
   * Draft authors and current assignees may open the review form.
   */
  public function form(BbCommentInterface $bb_comment, AccountInterface $account): AccessResultInterface {
    if ($bb_comment->bundle() !== 'review') {
      return AccessResult::forbidden('Only review comments use this form.')
        ->addCacheableDependency($bb_comment);
    }
    return $bb_comment->access('update', $account, TRUE);
  }

  /**
   * Access to a review's state widget: a review the account may view.
   *
   * The widget offers only the transitions the state machine allows this
   * account, and the save re-checks them.
   */
  public function transition(BbCommentInterface $bb_comment, AccountInterface $account): AccessResultInterface {
    if ($bb_comment->bundle() !== 'review') {
      return AccessResult::forbidden('Only review comments have a state widget.')
        ->addCacheableDependency($bb_comment);
    }
    return $bb_comment->access('view', $account, TRUE);
  }

}
