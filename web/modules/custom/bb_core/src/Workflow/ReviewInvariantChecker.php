<?php

declare(strict_types=1);

namespace Drupal\bb_core\Workflow;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Review save invariants independent of publication and audit stamping.
 */
final class ReviewInvariantChecker {

  public function __construct(
    private readonly AccountInterface $currentUser,
  ) {
  }

  /**
   * Review invariant messages, empty when the comment may be saved.
   *
   * @return list<string>
   *   Human-readable violations, or an empty list when the save is allowed.
   */
  public function messages(BbCommentInterface $comment): array {
    if ($comment->bundle() !== 'review') {
      return $this->legacyViolations($comment);
    }
    if ($comment->isNew()) {
      return $this->createViolations($comment);
    }
    return $this->updateViolations($comment);
  }

  /**
   * Whether the actor is still an assigned reviewer of the ticket.
   */
  public function isAssignedReviewer(BbTicketInterface $ticket, AccountInterface $account): bool {
    foreach ($ticket->get('reviewers') as $item) {
      $target_id = $item->getValue()['target_id'] ?? NULL;
      if ((int) $target_id === (int) $account->id()) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Create-time review invariants.
   *
   * @return list<string>
   *   Violations for a new review, or empty when create is allowed.
   */
  private function createViolations(BbCommentInterface $comment): array {
    return [
      ...$this->createStateViolations($comment),
      ...$this->createAuthorViolations($comment),
    ];
  }

  /**
   * Draft, publication and empty-audit rules for a new review.
   *
   * @return list<string>
   *   State and audit violations on create.
   */
  private function createStateViolations(BbCommentInterface $comment): array {
    $messages = [];
    $state = (string) $comment->get('review_state')->value;
    if ($state !== '' && $state !== 'draft') {
      $messages[] = 'Reviews must be created as unpublished drafts.';
    }
    if ($comment->isPublished()) {
      $messages[] = 'Reviews cannot be published on create.';
    }
    if (!$comment->get('submitted_at')->isEmpty()
      || !$comment->get('decided_at')->isEmpty()
      || !$comment->get('decided_by')->isEmpty()) {
      $messages[] = 'Review audit fields are server-owned.';
    }
    return $messages;
  }

  /**
   * Ticket and assigned-author rules for a new review.
   *
   * @return list<string>
   *   Authoring violations on create.
   */
  private function createAuthorViolations(BbCommentInterface $comment): array {
    $ticket = $comment->get('ticket_id')->entity;
    if (!$ticket instanceof BbTicketInterface) {
      return ['Reviews require a ticket.'];
    }
    $author = $comment->getOwner();
    if ($author instanceof AccountInterface && $this->isAssignedReviewer($ticket, $author)) {
      return [];
    }
    return ['Only an assigned reviewer may create a review.'];
  }

  /**
   * Update-time review invariants.
   *
   * @return list<string>
   *   Violations for an existing review, or empty when the save is allowed.
   */
  private function updateViolations(BbCommentInterface $comment): array {
    $original = $comment->getOriginal();
    if (!$original instanceof BbCommentInterface) {
      return [];
    }
    $from = (string) $original->get('review_state')->value;
    $to = (string) $comment->get('review_state')->value;
    return [
      ...$this->bundleChangeViolations($original),
      ...$this->immutabilityViolations($comment, $original, $from),
      ...$this->publicationViolations($comment, $from, $to),
      ...$this->forgedAuditViolations($comment, $original),
      ...$this->transitionAuthorityViolations($comment, $from, $to),
    ];
  }

  /**
   * Bundle identity must survive an update.
   *
   * @return list<string>
   *   A violation when the stored bundle is no longer review.
   */
  private function bundleChangeViolations(BbCommentInterface $original): array {
    if ($original->bundle() === 'review') {
      return [];
    }
    return ['Comment bundle cannot be changed.'];
  }

  /**
   * Submitted reviews keep body, author, ticket, type and bundle.
   *
   * @return list<string>
   *   A violation when a submitted review is rewritten.
   */
  private function immutabilityViolations(BbCommentInterface $comment, BbCommentInterface $original, string $from): array {
    if (!in_array($from, ['submitted', 'accepted', 'rejected'], TRUE)) {
      return [];
    }
    if ((string) $comment->get('body')->value !== (string) $original->get('body')->value
      || (int) $comment->get('author')->target_id !== (int) $original->get('author')->target_id
      || $comment->getTicketId() !== $original->getTicketId()
      || (string) $comment->get('type')->value !== (string) $original->get('type')->value
      || $comment->bundle() !== $original->bundle()) {
      return ['Submitted reviews are immutable.'];
    }
    return [];
  }

  /**
   * Publication follows the accepted state, allowing unpublished accept.
   *
   * @return list<string>
   *   A violation when status disagrees with the destination state.
   */
  private function publicationViolations(BbCommentInterface $comment, string $from, string $to): array {
    $will_publish = $to === 'accepted';
    $accepting = $from === 'submitted' && $to === 'accepted';
    if ($comment->isPublished() === $will_publish || ($accepting && !$comment->isPublished())) {
      return [];
    }
    return ['Review publication follows the accepted state.'];
  }

  /**
   * Client-forged audit values that are not the stored ones.
   *
   * @return list<string>
   *   A violation when audit fields were rewritten outside a decision.
   */
  private function forgedAuditViolations(BbCommentInterface $comment, BbCommentInterface $original): array {
    $from = (string) $original->get('review_state')->value;
    $to = (string) $comment->get('review_state')->value;
    $decision = ($from === 'submitted' && ($to === 'accepted' || $to === 'rejected'));
    if ($decision) {
      return [];
    }
    if ((string) $comment->get('submitted_at')->value === (string) $original->get('submitted_at')->value
      && (string) $comment->get('decided_at')->value === (string) $original->get('decided_at')->value
      && (string) $comment->get('decided_by')->target_id === (string) $original->get('decided_by')->target_id) {
      return [];
    }
    return ['Review audit fields are server-owned.'];
  }

  /**
   * Who may change review_state; used when save() skips form/API validation.
   *
   * @return list<string>
   *   A violation when the actor may not apply this transition.
   */
  private function transitionAuthorityViolations(BbCommentInterface $comment, string $from, string $to): array {
    if ($from === $to) {
      return [];
    }
    $ticket = $comment->get('ticket_id')->entity;
    if (!$ticket instanceof BbTicketInterface) {
      return ['Reviews require a ticket.'];
    }
    if ($from === 'draft' && $to === 'submitted') {
      return $this->submitAuthority($comment, $ticket);
    }
    if ($from === 'submitted' && ($to === 'accepted' || $to === 'rejected')) {
      return $this->decideAuthority($ticket);
    }
    return ['Invalid review transition.'];
  }

  /**
   * Submit requires the assigned author and ticket view.
   *
   * @return list<string>
   *   A violation when the current user may not submit.
   */
  private function submitAuthority(BbCommentInterface $comment, BbTicketInterface $ticket): array {
    if ((int) $comment->getOwnerId() === (int) $this->currentUser->id()
      && $this->isAssignedReviewer($ticket, $this->currentUser)
      && $ticket->access('view', $this->currentUser)) {
      return [];
    }
    return ['Only the assigned author may submit this review.'];
  }

  /**
   * Accept and reject require the current assignee and ticket view.
   *
   * @return list<string>
   *   A violation when the current user may not decide.
   */
  private function decideAuthority(BbTicketInterface $ticket): array {
    if ((int) $ticket->get('assignee_user_id')->target_id === (int) $this->currentUser->id()
      && $ticket->access('view', $this->currentUser)) {
      return [];
    }
    return ['Only the current assignee may decide this review.'];
  }

  /**
   * Legacy comments cannot be used by assigned reviewers to skip moderation.
   *
   * @return list<string>
   *   A violation when the actor must use the review bundle, otherwise empty.
   */
  private function legacyViolations(BbCommentInterface $comment): array {
    if (!$comment->isNew()) {
      return [];
    }
    $ticket = $comment->get('ticket_id')->entity;
    if (!$ticket instanceof BbTicketInterface) {
      return [];
    }
    if (!$this->isAssignedReviewer($ticket, $this->currentUser)) {
      return [];
    }
    if ($ticket->access('update', $this->currentUser)) {
      return [];
    }
    return ['Assigned reviewers must use the review comment bundle.'];
  }

}
