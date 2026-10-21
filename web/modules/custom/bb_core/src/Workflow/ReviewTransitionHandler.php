<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workflow;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Server-owned review publication and audit values.
 *
 * Guards decide who may transition; this stamps status and audit fields so a
 * client cannot publish independently or impersonate a decision maker.
 */
final class ReviewTransitionHandler {

  public function __construct(
    private readonly AccountInterface $currentUser,
    private readonly TimeInterface $time,
    private readonly ReviewInvariantChecker $invariants,
    private readonly Connection $database,
  ) {
  }

  /**
   * Applies publication and audit values that clients must not author.
   *
   * @throws \Drupal\Core\Entity\EntityStorageException
   *   When the save would violate a review invariant.
   */
  public function prepareSave(BbCommentInterface $comment): void {
    $messages = $this->violations($comment);
    if ($messages !== []) {
      throw new EntityStorageException($messages[0]);
    }
    $this->lockTransition($comment);
    $this->stamp($comment);
  }

  /**
   * Serializes every review write against concurrent state changes.
   *
   * The preSave hook runs inside the storage transaction. Locking the review
   * row (and, for a decision, the ticket's assignee) makes a second concurrent
   * decision wait, then fail on the state the first one committed. SQLite
   * ignores FOR UPDATE; MariaDB honours it.
   *
   * @throws \Drupal\Core\Entity\EntityStorageException
   *   When the stored state or assignee changed after this save began.
   */
  private function lockTransition(BbCommentInterface $comment): void {
    $original = $comment->bundle() === 'review' ? $comment->getOriginal() : NULL;
    if (!$original instanceof BbCommentInterface) {
      return;
    }
    $from = (string) $original->get('review_state')->value;
    $to = (string) $comment->get('review_state')->value;
    // Every write of an existing review: a draft save must not overwrite a
    // submit that landed meanwhile.
    $stored = $this->lockedValue('bb_comment', 'review_state', (int) $comment->id());
    if ((string) $stored !== $from) {
      throw new EntityStorageException('This review changed meanwhile; reload it.');
    }
    if ($from !== 'submitted' || $from === $to) {
      return;
    }
    $assignee = $this->lockedValue('bb_ticket', 'assignee_user_id', (int) $comment->getTicketId());
    if ((int) $assignee !== (int) $this->currentUser->id()) {
      throw new EntityStorageException('Only the current assignee may decide this review.');
    }
  }

  /**
   * Review invariant messages, empty when the comment may be saved.
   *
   * @return list<string>
   *   Human-readable violations, or an empty list when the save is allowed.
   */
  public function violations(BbCommentInterface $comment): array {
    return $this->invariants->messages($comment);
  }

  /**
   * Writes status and audit fields for an allowed review transition.
   */
  public function stamp(BbCommentInterface $comment): void {
    if ($comment->bundle() !== 'review') {
      $this->stampLegacy($comment);
      return;
    }
    if ($comment->isNew()) {
      $this->stampNewReview($comment);
      return;
    }
    $this->stampExistingReview($comment);
  }

  /**
   * Stamps an existing review from its stored original.
   */
  private function stampExistingReview(BbCommentInterface $comment): void {
    $original = $comment->getOriginal();
    if (!$original instanceof BbCommentInterface) {
      return;
    }
    $from = (string) $original->get('review_state')->value;
    $to = (string) $comment->get('review_state')->value;
    $this->stampTransition($comment, $original, $from, $to);
  }

  /**
   * Dispatches publication and audit writes for one review_state change.
   */
  private function stampTransition(BbCommentInterface $comment, BbCommentInterface $original, string $from, string $to): void {
    if ($from === 'draft' && $to === 'submitted') {
      $this->stampSubmit($comment);
      return;
    }
    if ($from === 'submitted' && $to === 'accepted') {
      $comment->setPublished();
      $this->stampDecision($comment, $original);
      return;
    }
    if ($from === 'submitted' && $to === 'rejected') {
      $comment->setUnpublished();
      $this->stampDecision($comment, $original);
      return;
    }
    if ($from === $to) {
      $this->restorePublication($comment, $original);
    }
  }

  /**
   * Reads one column of one base-table row FOR UPDATE.
   */
  private function lockedValue(string $table, string $column, int $id): mixed {
    $query = $this->database->select($table, 'r');
    $query->fields('r', [$column]);
    $query->condition('id', $id);
    $query->forUpdate();
    return $query->execute()?->fetchField();
  }

  /**
   * Whether the actor is still an assigned reviewer of the ticket.
   */
  public function isAssignedReviewer(BbTicketInterface $ticket, AccountInterface $account): bool {
    return $this->invariants->isAssignedReviewer($ticket, $account);
  }

  /**
   * Legacy comments stay published on create.
   */
  private function stampLegacy(BbCommentInterface $comment): void {
    if ($comment->isNew()) {
      $comment->setPublished();
    }
  }

  /**
   * New reviews are unpublished drafts with a server-owned author.
   */
  private function stampNewReview(BbCommentInterface $comment): void {
    $comment->setUnpublished();
    if ($comment->get('review_state')->isEmpty()) {
      $comment->set('review_state', 'draft');
    }
    if ($comment->get('author')->isEmpty()) {
      $comment->set('author', $this->currentUser->id());
    }
  }

  /**
   * Submit records the first submitted_at and keeps the review unpublished.
   */
  private function stampSubmit(BbCommentInterface $comment): void {
    $comment->setUnpublished();
    if ($comment->get('submitted_at')->isEmpty()) {
      $comment->set('submitted_at', $this->time->getRequestTime());
    }
  }

  /**
   * Same-state saves restore publication and audit from the stored row.
   */
  private function restorePublication(BbCommentInterface $comment, BbCommentInterface $original): void {
    if ($original->isPublished()) {
      $comment->setPublished();
    }
    if (!$original->isPublished()) {
      $comment->setUnpublished();
    }
    $comment->set('submitted_at', $original->get('submitted_at')->value);
    $comment->set('decided_at', $original->get('decided_at')->value);
    $comment->set('decided_by', $original->get('decided_by')->target_id);
  }

  /**
   * Records the current assignee as the decision maker once.
   */
  private function stampDecision(BbCommentInterface $comment, BbCommentInterface $original): void {
    $now = $this->time->getRequestTime();
    $decided_at = $original->get('decided_at')->isEmpty()
      ? $now
      : $original->get('decided_at')->value;
    $decided_by = $original->get('decided_by')->isEmpty()
      ? $this->currentUser->id()
      : $original->get('decided_by')->target_id;
    $submitted_at = $original->get('submitted_at')->isEmpty()
      ? $now
      : $original->get('submitted_at')->value;
    $comment->set('decided_at', $decided_at);
    $comment->set('decided_by', $decided_by);
    $comment->set('submitted_at', $submitted_at);
  }

}
