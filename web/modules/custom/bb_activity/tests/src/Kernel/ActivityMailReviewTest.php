<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Reviewers hear that they are asked; requesters hear that a review is in.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityMailReviewTest extends ActivityMailKernelTestBase {

  /**
   * An added reviewer who ticked the message gets one mail.
   */
  public function testAnAddedReviewerGetsOneMail(): void {
    $reviewer = $this->recipient('a', 'reviewer-a');
    $this->tick($reviewer, ['review_requested']);

    $this->ticket('a')->set('reviewers', [$reviewer->id()])->save();
    $this->ticket('a')->set('title', 'renamed')->save();

    $mails = $this->mailsTo($reviewer);
    self::assertCount(1, $mails);
    self::assertStringContainsString('[' . $this->ticket('a')->getIdentifier() . '] Your review was requested', (string) $mails[0]->getSubject());
  }

  /**
   * Adding a second reviewer mails only the one added.
   */
  public function testOnlyTheNewlyAddedReviewerIsMailed(): void {
    $first = $this->recipient('a', 'first-a');
    $second = $this->recipient('a', 'second-a');
    $this->tick($first, ['review_requested']);
    $this->tick($second, ['review_requested']);

    $this->ticket('a')->set('reviewers', [$first->id()])->save();
    $this->ticket('a')->set('reviewers', [$first->id(), $second->id()])->save();

    self::assertCount(1, $this->mailsTo($first));
    self::assertCount(1, $this->mailsTo($second));
  }

  /**
   * The account that asked for a review hears when it is submitted.
   */
  public function testTheRequesterGetsOneMailWhenTheReviewIsSubmitted(): void {
    $requester = $this->recipient('a', 'requester-a');
    $reviewer = $this->recipient('a', 'reviewer-a');
    $this->tick($requester, ['review_completed']);
    $this->actingAs($requester, fn () => $this->ticket('a')->set('reviewers', [$reviewer->id()])->save());

    $this->actingAs($reviewer, function () use ($reviewer): void {
      $review = $this->draftBy($reviewer);
      self::assertCount(0, $this->transport->sent, 'A draft mails nobody.');
      $item = $review->get('review_state')->first();
      self::assertInstanceOf(StateItemInterface::class, $item);
      $item->applyTransitionById('submit');
      $review->save();
    });

    $mails = $this->mailsTo($requester);
    self::assertCount(1, $mails);
    self::assertStringContainsString('A review was submitted', (string) $mails[0]->getSubject());
  }

  /**
   * An account that cannot view the ticket gets no review mail it ticked.
   */
  public function testAnOutsiderAddedAsReviewerGetsNothing(): void {
    $outsider = $this->recipient('b', 'outsider-b');
    $this->tick($outsider, ['review_requested', 'review_completed']);

    $this->ticket('a')->set('reviewers', [$outsider->id()])->save();

    self::assertCount(0, $this->mailsTo($outsider));
  }

  /**
   * Runs a callable as an account.
   */
  private function actingAs(UserInterface $account, callable $callable): void {
    $this->container->get('account_switcher')->switchTo($account);
    try {
      $callable();
    }
    finally {
      $this->container->get('account_switcher')->switchBack();
    }
  }

  /**
   * A saved review draft on side a's ticket.
   */
  private function draftBy(UserInterface $author): BbCommentInterface {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $review = $storage->create([
      'bundle' => 'review',
      'ticket_id' => $this->ticket('a')->id(),
      'author' => $author->id(),
      'body' => ['value' => 'looks good', 'format' => 'plain_text'],
      'type' => 'comment',
    ]);
    self::assertInstanceOf(BbCommentInterface::class, $review);
    $review->save();
    $review = $storage->loadUnchanged($review->id());
    self::assertInstanceOf(BbCommentInterface::class, $review);
    return $review;
  }

}
