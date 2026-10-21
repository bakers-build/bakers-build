<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\jsonapi\ResourceType\ResourceType;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Review-bundle lifecycle, publication and immutability.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ReviewCommentLifecycleTest extends KernelTestBase {

  use OgScopeFixtureTrait;
  use ReviewStateTrait;
  use UserCreationTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'file', 'image',
    'system', 'user', 'options', 'entity', 'state_machine',
    'field', 'og', 'link', 'text', 'filter',
    'serialization', 'jsonapi',
    'bb_core',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    foreach ([
      'user', 'og_membership', 'bb_workspace', 'bb_group', 'bb_team',
      'bb_project', 'bb_ticket', 'bb_comment', 'bb_run',
    ] as $type) {
      $this->installEntitySchema($type);
    }
    $this->installConfig(['system', 'user', 'jsonapi']);
    $this->installOgScopeFixture();
    $this->createUser();
  }

  /**
   * Legacy and review are distinct JSON:API resources; type stays free text.
   */
  public function testResourceTypesAndLegacyTypeField(): void {
    $legacy = $this->container->get('jsonapi.resource_type.repository')
      ->get('bb_comment', 'bb_comment');
    $review = $this->container->get('jsonapi.resource_type.repository')
      ->get('bb_comment', 'review');
    self::assertInstanceOf(ResourceType::class, $legacy);
    self::assertInstanceOf(ResourceType::class, $review);
    self::assertSame('bb_comment--bb_comment', $legacy->getTypeName());
    self::assertSame('bb_comment--review', $review->getTypeName());
    self::assertTrue($legacy->hasField('type'));
    self::assertSame('bb_comment_type', $legacy->getPublicName('type'));
  }

  /**
   * New reviews start unpublished in draft; new legacy comments stay published.
   */
  public function testDefaultsByBundle(): void {
    $actors = $this->actors();
    $legacy = $this->createComment($actors['ticket'], $actors['assignee'], [
      'type' => 'review',
    ]);
    self::assertSame('bb_comment', $legacy->bundle());
    self::assertTrue($legacy->isPublished());
    self::assertSame('review', $legacy->get('type')->value);

    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    self::assertSame('review', $review->bundle());
    self::assertFalse($review->isPublished());
    self::assertSame('draft', $review->get('review_state')->value);
    self::assertTrue($review->get('submitted_at')->isEmpty());
    self::assertTrue($review->get('decided_at')->isEmpty());
    self::assertTrue($review->get('decided_by')->isEmpty());
  }

  /**
   * Submit, accept and reject follow the publication table and write audit.
   */
  public function testSubmitAcceptRejectAndAudit(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $review = $this->reloadComment($review);
    self::assertSame('submitted', $review->get('review_state')->value);
    self::assertFalse($review->isPublished());
    self::assertNotEmpty($review->get('submitted_at')->value);
    $submitted_at = $review->get('submitted_at')->value;

    $this->setCurrentUser($actors['assignee']);
    $this->applyReviewTransition($review, 'accept');
    $review->save();
    $review = $this->reloadComment($review);
    self::assertSame('accepted', $review->get('review_state')->value);
    self::assertTrue($review->isPublished());
    self::assertSame($submitted_at, $review->get('submitted_at')->value);
    self::assertNotEmpty($review->get('decided_at')->value);
    self::assertSame((int) $actors['assignee']->id(), (int) $review->get('decided_by')->target_id);
    self::assertSame('todo', $this->reloadTicket($actors['ticket'])->get('state')->value);

    $rejected = $this->createReview($actors['ticket'], $actors['reviewer'], [
      'body' => ['value' => 'please change', 'format' => 'plain_text'],
    ]);
    $this->setCurrentUser($actors['reviewer']);
    $this->applyReviewTransition($rejected, 'submit');
    $rejected->save();
    $this->setCurrentUser($actors['assignee']);
    $this->applyReviewTransition($rejected, 'reject');
    $rejected->save();
    $rejected = $this->reloadComment($rejected);
    self::assertSame('rejected', $rejected->get('review_state')->value);
    self::assertFalse($rejected->isPublished());
    self::assertSame((int) $actors['assignee']->id(), (int) $rejected->get('decided_by')->target_id);
  }

  /**
   * Submitted body, author, ticket, bundle and type cannot change.
   */
  public function testSubmittedTextIsImmutable(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $before = $this->snapshot($review);
    $review->set('body', ['value' => 'rewritten', 'format' => 'plain_text']);
    $this->assertSaveRejected($review);
    self::assertSame($before, $this->snapshot($this->reloadComment($review)));
  }

  /**
   * Direct create as accepted, status=true and forged audit are rejected.
   */
  public function testForgedCreateAndAuditAreRejected(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $forged = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'bundle' => 'review',
        'ticket_id' => $actors['ticket']->id(),
        'author' => $actors['reviewer']->id(),
        'body' => ['value' => 'forged', 'format' => 'plain_text'],
        'type' => 'comment',
        'review_state' => 'accepted',
        'status' => 1,
        'decided_by' => $actors['reviewer']->id(),
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $forged);
    self::assertGreaterThan(0, count($forged->validate()));
    $this->assertSaveRejected($forged);

    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $before = $this->snapshot($review);
    $review->set('status', TRUE);
    $this->assertSaveRejected($review);
    self::assertSame($before, $this->snapshot($this->reloadComment($review)));

    $review->set('decided_by', $actors['reviewer']->id());
    $this->assertSaveRejected($review);
    self::assertSame($before, $this->snapshot($this->reloadComment($review)));
  }

  /**
   * Repeating accept does not duplicate the comment or rewrite audit.
   */
  public function testRepeatAcceptIsIdempotent(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $this->setCurrentUser($actors['assignee']);
    $this->applyReviewTransition($review, 'accept');
    $review->save();
    $accepted = $this->reloadComment($review);
    $audit = [
      $accepted->get('decided_at')->value,
      $accepted->get('decided_by')->target_id,
    ];
    $accepted->save();
    $again = $this->reloadComment($accepted);
    self::assertSame($audit, [
      $again->get('decided_at')->value,
      $again->get('decided_by')->target_id,
    ]);
    $ids = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id', $actors['ticket']->id())
      ->condition('bundle', 'review')
      ->execute();
    self::assertCount(1, $ids);
  }

  /**
   * An unassigned ticket keeps the submitted review; nobody can decide.
   */
  public function testMissingAssigneeCannotDecide(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $actors['ticket']->set('assignee_user_id', NULL)->save();
    $this->setCurrentUser($actors['owner']);
    $before = $this->snapshot($this->reloadComment($review));
    $review = $this->reloadComment($review);
    $review->set('review_state', 'accepted');
    $this->assertSaveRejected($review);
    self::assertSame($before, $this->snapshot($this->reloadComment($review)));
  }

  /**
   * Reassignment moves pending decision authority to the new assignee.
   */
  public function testReassignmentTransfersDecision(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $actors['ticket']->set('assignee_user_id', $actors['other']->id())->save();
    $this->setCurrentUser($actors['assignee']);
    $before = $this->snapshot($this->reloadComment($review));
    $review = $this->reloadComment($review);
    $review->set('review_state', 'accepted');
    $this->assertSaveRejected($review);
    self::assertSame($before, $this->snapshot($this->reloadComment($review)));

    $this->setCurrentUser($actors['other']);
    $review = $this->reloadComment($review);
    $this->applyReviewTransition($review, 'accept');
    $review->save();
    $review = $this->reloadComment($review);
    self::assertSame('accepted', $review->get('review_state')->value);
    self::assertSame((int) $actors['other']->id(), (int) $review->get('decided_by')->target_id);
  }

  /**
   * Computed comment lists include only published comments.
   */
  public function testComputedListsArePublishedOnly(): void {
    $actors = $this->actors();
    $legacy = $this->createComment($actors['ticket'], $actors['assignee'], [
      'type' => 'comment',
      'body' => ['value' => 'handoff', 'format' => 'plain_text'],
    ]);
    $summary = $this->createComment($actors['ticket'], $actors['assignee'], [
      'type' => 'summary',
      'body' => ['value' => 'status', 'format' => 'plain_text'],
    ]);
    $this->setCurrentUser($actors['reviewer']);
    $draft = $this->createReview($actors['ticket'], $actors['reviewer']);
    $ticket = $this->reloadTicket($actors['ticket']);
    $comment_ids = $this->targetIds($ticket->get('comments'));
    self::assertContains((string) $legacy->id(), $comment_ids);
    self::assertContains((string) $summary->id(), $comment_ids);
    self::assertNotContains((string) $draft->id(), $comment_ids);
    self::assertNotContains((string) $draft->id(), $this->targetIds($ticket->get('handoff_comments')));
    $summary_ids = $this->targetIds($ticket->get('summary_comment'));
    self::assertSame([(string) $summary->id()], $summary_ids);
  }

  /**
   * Builds a workspace ticket with owner, assignee, reviewer and a spare user.
   *
   * @return array<string, mixed>
   *   Named accounts and the ticket.
   */
  private function actors(): array {
    $owner = $this->account('owner');
    $assignee = $this->account('assignee');
    $reviewer = $this->account('reviewer');
    $other = $this->account('other');
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'ws', 'slug' => 'ws']);
    $workspace->save();
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create(['name' => 'p', 'group_id' => $group->id()]);
    $project->save();
    foreach ([$owner, $assignee, $reviewer, $other] as $account) {
      $this->addMembership($workspace, $account, ['contributor']);
    }
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'title' => 'review-lifecycle',
        'workflow' => 'bb_feature',
        'state' => 'todo',
        'project_id' => $project->id(),
        'owner_user_id' => $owner->id(),
        'assignee_user_id' => $assignee->id(),
        'reviewers' => [$reviewer->id()],
      ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    $ticket->save();
    return [
      'owner' => $owner,
      'assignee' => $assignee,
      'reviewer' => $reviewer,
      'other' => $other,
      'ticket' => $ticket,
    ];
  }

  /**
   * Creates a saved user.
   */
  private function account(string $name): UserInterface {
    $account = $this->createUser([
      'view bb_ticket',
      'view bb_comment',
      'create bb_comment',
      'update own bb_comment',
      'delete own bb_comment',
    ], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
  }

  /**
   * Creates a saved legacy comment.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The parent ticket.
   * @param \Drupal\user\UserInterface $author
   *   The comment author.
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  private function createComment(BbTicketInterface $ticket, UserInterface $author, array $values = []): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create($values + [
        'ticket_id' => $ticket->id(),
        'author' => $author->id(),
        'body' => ['value' => 'legacy body', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();
    return $this->reloadComment($comment);
  }

  /**
   * Creates a saved review draft.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The parent ticket.
   * @param \Drupal\user\UserInterface $author
   *   The review author.
   * @param array<string, mixed> $values
   *   Extra field values.
   */
  private function createReview(BbTicketInterface $ticket, UserInterface $author, array $values = []): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create($values + [
        'bundle' => 'review',
        'ticket_id' => $ticket->id(),
        'author' => $author->id(),
        'body' => ['value' => 'looks good', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();
    return $this->reloadComment($comment);
  }

  /**
   * Reloads a comment from storage.
   */
  private function reloadComment(BbCommentInterface $comment): BbCommentInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $storage->resetCache([(string) $comment->id()]);
    $reloaded = $storage->load($comment->id());
    self::assertInstanceOf(BbCommentInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Reloads a ticket from storage.
   */
  private function reloadTicket(BbTicketInterface $ticket): BbTicketInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([(string) $ticket->id()]);
    $reloaded = $storage->load($ticket->id());
    self::assertInstanceOf(BbTicketInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Stable field snapshot used to prove a rejected write changed nothing.
   *
   * @return array<string, mixed>
   *   Comparable field values.
   */
  private function snapshot(BbCommentInterface $comment): array {
    return [
      'bundle' => $comment->bundle(),
      'type' => $comment->get('type')->value,
      'body' => $comment->get('body')->value,
      'author' => $comment->get('author')->target_id,
      'ticket' => $comment->getTicketId(),
      'status' => $comment->isPublished(),
      'state' => $comment->hasField('review_state') ? (string) $comment->get('review_state')->value : NULL,
      'submitted_at' => $comment->hasField('submitted_at') ? (string) $comment->get('submitted_at')->value : '',
      'decided_at' => $comment->hasField('decided_at') ? (string) $comment->get('decided_at')->value : '',
      'decided_by' => $comment->hasField('decided_by') ? (string) $comment->get('decided_by')->target_id : '',
    ];
  }

  /**
   * Asserts that saving the comment is rejected and does not persist.
   */
  private function assertSaveRejected(BbCommentInterface $comment): void {
    $violations = $comment->validate();
    if (count($violations) > 0) {
      return;
    }
    try {
      $comment->save();
      self::fail('Expected the review write to be rejected.');
    }
    catch (EntityStorageException) {
    }
  }

  /**
   * Target IDs of a computed reference list.
   *
   * @return array<int, string>
   *   Target ids in list order.
   */
  private function targetIds(mixed $items): array {
    $ids = [];
    foreach ($items as $item) {
      $ids[] = (string) $item->target_id;
    }
    return $ids;
  }

}
