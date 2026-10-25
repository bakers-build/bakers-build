<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Private review visibility, authoring rights and query isolation.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class ReviewCommentAccessTest extends KernelTestBase {

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
   * An assigned reviewer without ticket update must use the review bundle.
   */
  public function testAssignedReviewerCannotBypassWithLegacyComment(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $legacy = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'ticket_id' => $actors['ticket']->id(),
        'author' => $actors['reviewer']->id(),
        'body' => ['value' => 'bypass', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $legacy);
    self::assertGreaterThan(0, count($legacy->validate()));
    try {
      $legacy->save();
      self::fail('Assigned reviewers must not persist a legacy comment.');
    }
    catch (EntityStorageException) {
    }

    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    self::assertFalse($review->isPublished());
    self::assertTrue($review->access('view', $actors['reviewer']));
    self::assertTrue($review->access('update', $actors['reviewer']));
    self::assertFalse($review->access('view', $actors['reader']));
    self::assertFalse($review->access('view', $actors['assignee']));
    self::assertFalse($review->get('status')->access('edit', $actors['reviewer']));
    self::assertFalse($review->get('decided_by')->access('edit', $actors['reviewer']));
  }

  /**
   * Session-scope authors can submit their own draft without comment update.
   */
  public function testSessionScopeAuthorCanUpdateOwnDraft(): void {
    $actors = $this->actors();
    $session = $this->account('session', ['write bakers via session scope']);
    $actors['ticket']->set('reviewers', [
      $actors['reviewer']->id(),
      $session->id(),
    ])->save();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $session);
    self::assertTrue($review->access('update', $session));
    self::assertTrue($review->get('review_state')->access('edit', $session));
    $this->setCurrentUser($session);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $review = $this->reload($review);
    $this->container->get('entity_type.manager')
      ->getAccessControlHandler('bb_comment')
      ->resetCache();
    self::assertSame('submitted', (string) $review->get('review_state')->value);
    self::assertFalse($review->isPublished());
    self::assertFalse($review->access('update', $session));
  }

  /**
   * Assignees, agents and readers keep ordinary legacy comment create.
   */
  public function testNonReviewerLegacyCommentsStayAllowed(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['assignee']);
    $comment = $this->createLegacy($actors['ticket'], $actors['assignee']);
    self::assertTrue($comment->isPublished());
    self::assertTrue($comment->access('view', $actors['reader']));
    self::assertTrue($comment->access('view', $actors['reviewer']));
  }

  /**
   * Submitted reviews stay private to author and current assignee.
   */
  public function testSubmittedVisibilityAndReassignment(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $review = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($review, 'submit');
    $review->save();
    $review = $this->reload($review);

    self::assertFalse($review->isPublished());
    self::assertTrue($review->access('view', $actors['reviewer']));
    self::assertTrue($review->access('view', $actors['assignee']));
    self::assertTrue($review->access('update', $actors['assignee']));
    self::assertFalse($review->access('view', $actors['reader']));
    self::assertFalse($review->access('update', $actors['reviewer']));
    self::assertFalse($review->access('delete', $actors['reviewer']));
    self::assertFalse($review->access('view', $actors['other']));

    $ids = $this->visibleIds($actors['ticket'], $actors['assignee']);
    self::assertContains((string) $review->id(), $ids);
    self::assertNotContains((string) $review->id(), $this->visibleIds($actors['ticket'], $actors['reader']));

    $actors['ticket']->set('assignee_user_id', $actors['other']->id())->save();
    $review = $this->reload($review);
    self::assertFalse($review->access('view', $actors['assignee']));
    self::assertTrue($review->access('view', $actors['other']));
    self::assertNotContains((string) $review->id(), $this->visibleIds($actors['ticket'], $actors['assignee']));
    self::assertContains((string) $review->id(), $this->visibleIds($actors['ticket'], $actors['other']));
  }

  /**
   * Acceptance publishes to ordinary readers; rejection does not.
   */
  public function testAcceptPublishesAndRejectStaysPrivate(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $accepted = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($accepted, 'submit');
    $accepted->save();
    $this->setCurrentUser($actors['assignee']);
    $this->applyReviewTransition($accepted, 'accept');
    $accepted->save();
    $accepted = $this->reload($accepted);
    self::assertTrue($accepted->isPublished());
    self::assertTrue($accepted->access('view', $actors['reader']));
    self::assertContains((string) $accepted->id(), $this->visibleIds($actors['ticket'], $actors['reader']));

    $this->setCurrentUser($actors['reviewer']);
    $rejected = $this->createReview($actors['ticket'], $actors['reviewer'], [
      'body' => ['value' => 'changes', 'format' => 'plain_text'],
    ]);
    $this->applyReviewTransition($rejected, 'submit');
    $rejected->save();
    $this->setCurrentUser($actors['assignee']);
    $this->applyReviewTransition($rejected, 'reject');
    $rejected->save();
    $rejected = $this->reload($rejected);
    self::assertFalse($rejected->isPublished());
    self::assertFalse($rejected->access('view', $actors['reader']));
    self::assertNotContains((string) $rejected->id(), $this->visibleIds($actors['ticket'], $actors['reader']));
  }

  /**
   * An author who left the workspace cannot open their own reviews.
   */
  public function testAuthorWhoLeftTheWorkspaceCannotSeeOwnReviews(): void {
    $actors = $this->actors();
    // Ticket read access comes from the rank alone, as on a real site.
    $author = $this->createUser(['view bb_comment', 'create bb_comment', 'update own bb_comment'], 'rank-only');
    self::assertInstanceOf(UserInterface::class, $author);
    $workspace = $this->container->get('entity_type.manager')->getStorage('bb_workspace')
      ->loadByProperties(['slug' => 'ws-access']);
    $team = $this->container->get('entity_type.manager')->getStorage('bb_team')
      ->loadByProperties(['name' => 't']);
    $workspace = reset($workspace);
    $team = reset($team);
    self::assertInstanceOf(EntityInterface::class, $workspace);
    self::assertInstanceOf(EntityInterface::class, $team);
    $this->addMembership($workspace, $author, ['contributor']);
    $this->addMembership($team, $author, ['member']);
    $actors['ticket']->set('reviewers', [$actors['reviewer']->id(), $author->id()])->save();
    $this->setCurrentUser($author);
    $draft = $this->createReview($actors['ticket'], $author);
    $submitted = $this->createReview($actors['ticket'], $author);
    $this->applyReviewTransition($submitted, 'submit');
    $submitted->save();
    self::assertTrue($actors['ticket']->access('view', $author));
    self::assertTrue($this->reload($draft)->access('view', $author));

    $memberships = $this->container->get('entity_type.manager')->getStorage('og_membership');
    $memberships->delete($memberships->loadByProperties(['uid' => $author->id()]));
    $this->container->get('cache.static')->deleteAll();
    $this->container->get('entity.memory_cache')->deleteAll();
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_comment')->resetCache();
    $this->container->get('entity_type.manager')->getAccessControlHandler('bb_ticket')->resetCache();

    self::assertFalse($actors['ticket']->access('view', $author));
    self::assertFalse($this->reload($draft)->access('view', $author));
    self::assertFalse($this->reload($submitted)->access('view', $author));
    self::assertSame([], $this->visibleIds($actors['ticket'], $author));
  }

  /**
   * A guest reviewer edits and deletes their own draft by assignment alone.
   */
  public function testGuestReviewerManagesOwnDraftByAssignment(): void {
    $actors = $this->actors();
    $guest = $this->createUser(['view bb_comment'], 'guest-reviewer');
    self::assertInstanceOf(UserInterface::class, $guest);
    $etm = $this->container->get('entity_type.manager');
    $workspace = current($etm->getStorage('bb_workspace')->loadByProperties(['slug' => 'ws-access']));
    $team = current($etm->getStorage('bb_team')->loadByProperties(['name' => 't']));
    self::assertInstanceOf(EntityInterface::class, $workspace);
    self::assertInstanceOf(EntityInterface::class, $team);
    $this->addMembership($workspace, $guest, ['guest']);
    $this->addMembership($team, $guest, ['member']);
    $actors['ticket']->set('reviewers', [$actors['reviewer']->id(), $guest->id()])->save();
    $this->setCurrentUser($guest);
    $draft = $this->createReview($actors['ticket'], $guest);
    self::assertTrue($draft->access('update', $guest));
    self::assertTrue($draft->access('delete', $guest));

    $actors['ticket']->set('reviewers', [$actors['reviewer']->id()])->save();
    $etm->getAccessControlHandler('bb_comment')->resetCache();
    $draft = $this->reload($draft);
    self::assertFalse($draft->access('update', $guest), 'A removed reviewer no longer edits the draft.');
  }

  /**
   * Private review rows stay inside the author's workspace read scope.
   */
  public function testPrivateReviewRowsStayInsideWorkspaceScope(): void {
    $actors = $this->actors();
    $this->setCurrentUser($actors['reviewer']);
    $draft = $this->createReview($actors['ticket'], $actors['reviewer']);
    $submitted = $this->createReview($actors['ticket'], $actors['reviewer']);
    $this->applyReviewTransition($submitted, 'submit');
    $submitted->save();
    self::assertContains((string) $draft->id(), $this->visibleIds($actors['ticket'], $actors['reviewer']));
    self::assertContains((string) $submitted->id(), $this->visibleIds($actors['ticket'], $actors['assignee']));

    // The ticket moves into a workspace neither account belongs to.
    $storage = fn(string $type) => $this->container->get('entity_type.manager')->getStorage($type);
    $workspace = $storage('bb_workspace')->create(['name' => 'foreign', 'slug' => 'ws-foreign']);
    $workspace->save();
    $group = $storage('bb_group')->create(['name' => 'fg', 'workspace_id' => $workspace->id()]);
    $group->save();
    $project = $storage('bb_project')->create(['name' => 'fp', 'group_id' => $group->id()]);
    $project->save();
    $actors['ticket']->set('project_id', $project->id())->save();

    self::assertSame([], $this->visibleIds($actors['ticket'], $actors['reviewer']));
    self::assertSame([], $this->visibleIds($actors['ticket'], $actors['assignee']));
  }

  /**
   * Builds a workspace ticket with owner, assignee, reviewer, reader and spare.
   *
   * @return array<string, mixed>
   *   Named accounts and the ticket.
   */
  private function actors(): array {
    $owner = $this->account('owner', ['update any bb_ticket']);
    $assignee = $this->account('assignee', ['update own bb_comment']);
    $reviewer = $this->account('reviewer', [
      'create bb_comment',
      'update own bb_comment',
      'delete own bb_comment',
    ]);
    $reader = $this->account('reader');
    $other = $this->account('other', ['update own bb_comment']);
    $workspace = $this->container->get('entity_type.manager')
      ->getStorage('bb_workspace')
      ->create(['name' => 'ws', 'slug' => 'ws-access']);
    $workspace->save();
    $group = $this->container->get('entity_type.manager')
      ->getStorage('bb_group')
      ->create(['name' => 'g', 'workspace_id' => $workspace->id()]);
    $group->save();
    $team = $this->container->get('entity_type.manager')
      ->getStorage('bb_team')
      ->create(['name' => 't', 'workspace_id' => $workspace->id()]);
    $team->save();
    $project = $this->container->get('entity_type.manager')
      ->getStorage('bb_project')
      ->create([
        'name' => 'p',
        'group_id' => $group->id(),
        'teams' => [$team->id()],
      ]);
    $project->save();
    foreach ([$owner, $assignee, $reader, $other] as $account) {
      $this->addMembership($workspace, $account, ['contributor']);
      $this->addMembership($team, $account, ['member']);
    }
    $this->addMembership($workspace, $reviewer, ['guest']);
    $this->addMembership($team, $reviewer, ['member']);
    $ticket = $this->container->get('entity_type.manager')
      ->getStorage('bb_ticket')
      ->create([
        'title' => 'review-access',
        'workflow' => 'bb_work',
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
      'reader' => $reader,
      'other' => $other,
      'ticket' => $ticket,
    ];
  }

  /**
   * Creates a saved user with ticket and comment view.
   *
   * @param string $name
   *   Account name.
   * @param list<string> $extra
   *   Additional permissions.
   */
  private function account(string $name, array $extra = []): UserInterface {
    $account = $this->createUser([
      'view bb_ticket',
      'view bb_comment',
      ...$extra,
    ], $name);
    self::assertInstanceOf(UserInterface::class, $account);
    return $account;
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
    return $this->reload($comment);
  }

  /**
   * Creates a saved legacy comment.
   *
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The parent ticket.
   * @param \Drupal\user\UserInterface $author
   *   The comment author.
   */
  private function createLegacy(BbTicketInterface $ticket, UserInterface $author): BbCommentInterface {
    $comment = $this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->create([
        'ticket_id' => $ticket->id(),
        'author' => $author->id(),
        'body' => ['value' => 'handoff', 'format' => 'plain_text'],
        'type' => 'comment',
      ]);
    self::assertInstanceOf(BbCommentInterface::class, $comment);
    $comment->save();
    return $this->reload($comment);
  }

  /**
   * Reloads a comment from storage.
   */
  private function reload(BbCommentInterface $comment): BbCommentInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $storage->resetCache([(string) $comment->id()]);
    $reloaded = $storage->load($comment->id());
    self::assertInstanceOf(BbCommentInterface::class, $reloaded);
    return $reloaded;
  }

  /**
   * Comment ids the account may query for the ticket.
   *
   * @return list<string>
   *   Comment storage ids visible to the account.
   */
  private function visibleIds(BbTicketInterface $ticket, UserInterface $account): array {
    $this->setCurrentUser($account);
    return array_values($this->container->get('entity_type.manager')
      ->getStorage('bb_comment')
      ->getQuery()
      ->accessCheck(TRUE)
      ->condition('ticket_id', $ticket->id())
      ->execute());
  }

}
