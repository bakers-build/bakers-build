<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workflow;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\state_machine\Guard\GuardInterface;
use Drupal\state_machine\Plugin\Workflow\WorkflowInterface;
use Drupal\state_machine\Plugin\Workflow\WorkflowTransition;

/**
 * Who may submit or decide a review comment.
 */
final class ReviewCommentGuard implements GuardInterface {

  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly ReviewTransitionHandler $handler,
  ) {
  }

  /**
   * {@inheritdoc}
   */
  public function allowed(WorkflowTransition $transition, WorkflowInterface $workflow, EntityInterface $entity): bool {
    if (!$entity instanceof BbCommentInterface || $entity->bundle() !== 'review') {
      return TRUE;
    }
    $ticket = $entity->get('ticket_id')->entity;
    if (!$ticket instanceof BbTicketInterface) {
      return FALSE;
    }
    if (!$ticket->access('view', $this->currentUser)) {
      return FALSE;
    }
    $id = $transition->getId();
    if ($id === 'submit') {
      return (int) $entity->getOwnerId() === (int) $this->currentUser->id()
        && $this->handler->isAssignedReviewer($ticket, $this->currentUser);
    }
    if ($id === 'accept' || $id === 'reject') {
      return (int) $ticket->get('assignee_user_id')->target_id === (int) $this->currentUser->id();
    }
    return FALSE;
  }

}
