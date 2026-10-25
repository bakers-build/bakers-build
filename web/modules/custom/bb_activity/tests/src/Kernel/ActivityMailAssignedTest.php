<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The account made assignee hears about it, once, and only if it opted in.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityMailAssignedTest extends ActivityMailKernelTestBase {

  /**
   * An account made assignee who ticked the message gets one mail.
   */
  public function testTheNewAssigneeGetsOneMail(): void {
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned']);

    $this->ticket('a')->set('assignee_user_id', $assignee->id())->save();
    $this->ticket('a')->set('title', 'renamed')->save();

    $mails = $this->mailsTo($assignee);
    self::assertCount(1, $mails);
    self::assertStringContainsString('[' . $this->ticket('a')->getIdentifier() . '] You were assigned to this ticket', (string) $mails[0]->getSubject());
  }

  /**
   * Without the tick nothing is sent.
   */
  public function testAnUntickedAccountGetsNothing(): void {
    $assignee = $this->recipient('a', 'quiet-a');

    $this->ticket('a')->set('assignee_user_id', $assignee->id())->save();

    self::assertCount(0, $this->mailsTo($assignee));
  }

  /**
   * An account that cannot view the ticket gets no mail it ticked.
   */
  public function testAnOutsiderMadeAssigneeGetsNothing(): void {
    $outsider = $this->recipient('b', 'outsider-b');
    $this->tick($outsider, ['assigned']);

    $this->ticket('a')->set('assignee_user_id', $outsider->id())->save();

    self::assertCount(0, $this->mailsTo($outsider));
  }

  /**
   * Assigning the ticket to yourself is mailed too: the actor is not excluded.
   */
  public function testTheActorAssigningThemselvesIsMailed(): void {
    $actor = $this->recipient('a', 'actor-a');
    $this->tick($actor, ['assigned']);
    $this->actingAs($actor, fn () => $this->ticket('a')->set('assignee_user_id', $actor->id())->save());

    self::assertCount(1, $this->mailsTo($actor));
  }

  /**
   * A new ticket with an assignee sends the assignment mail, no creation mail.
   */
  public function testCreatingWithAnAssigneeSendsTheAssignmentMailOnly(): void {
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned', 'created']);

    $this->createEntity('bb_ticket', [
      'title' => 'fresh-assigned',
      'workflow' => 'bb_work',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'owner_user_id' => $assignee->id(),
      'assignee_user_id' => $assignee->id(),
    ]);

    $subjects = array_map(static fn ($email): string => (string) $email->getSubject(), $this->mailsTo($assignee));
    self::assertCount(1, $subjects);
    self::assertStringContainsString('You were assigned to this ticket', $subjects[0]);
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

}
