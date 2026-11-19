<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_activity\Entity\BbActivity;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The account made assignee by someone else hears about it, once, if opted in.
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
    self::assertStringContainsString('[' . $this->ticket('a')->getIdentifier() . '] bakers.build assigned you to this ticket', (string) $mails[0]->getSubject());
  }

  /**
   * The mail names who assigned the ticket and who created it.
   *
   * The apostrophe proves names arrive unescaped in subject and body.
   */
  public function testTheMailNamesAssignerAndCreator(): void {
    $assigner = $this->recipient('a', 'assigner-a');
    $creator = $this->recipient('a', "o'creator-a");
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned']);
    $this->ticket('a')->set('owner_user_id', $creator->id())->save();

    $this->actingAs($assigner, fn () => $this->ticket('a')->set('assignee_user_id', $assignee->id())->save());

    $line = "assigner-a assigned you to this ticket, created by o'creator-a";
    $email = $this->mailsTo($assignee)[0];
    self::assertSame('[' . $this->ticket('a')->getIdentifier() . '] ' . $line, (string) $email->getSubject());
    self::assertStringContainsString($line, (string) $email->getTextBody());
  }

  /**
   * An assigner who created the ticket is named once.
   */
  public function testAnAssignerWhoCreatedTheTicketIsNamedOnce(): void {
    $assigner = $this->recipient('a', 'assigner-a');
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned']);
    $this->ticket('a')->set('owner_user_id', $assigner->id())->save();

    $this->actingAs($assigner, fn () => $this->ticket('a')->set('assignee_user_id', $assignee->id())->save());

    self::assertStringEndsWith('] assigner-a assigned you to their ticket', (string) $this->mailsTo($assignee)[0]->getSubject());
  }

  /**
   * The creator made assignee of their own ticket reads "your ticket".
   */
  public function testTheCreatorReadsYourTicket(): void {
    $assigner = $this->recipient('a', 'assigner-a');
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned']);
    $this->ticket('a')->set('owner_user_id', $assignee->id())->save();

    $this->actingAs($assigner, fn () => $this->ticket('a')->set('assignee_user_id', $assignee->id())->save());

    self::assertStringEndsWith('] assigner-a assigned you to your ticket', (string) $this->mailsTo($assignee)[0]->getSubject());
  }

  /**
   * A row without an actor names bakers.build as the assigner.
   */
  public function testWithoutAnActorBakersBuildAssigned(): void {
    $creator = $this->recipient('a', 'creator-a');
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned']);
    $this->ticket('a')->set('owner_user_id', $creator->id())->save();

    $this->ticket('a')->set('assignee_user_id', $assignee->id())->save();

    self::assertStringEndsWith('] bakers.build assigned you to this ticket, created by creator-a', (string) $this->mailsTo($assignee)[0]->getSubject());
  }

  /**
   * People the recipient may not be told about are "Someone", and leak nothing.
   */
  public function testPeopleTheRecipientMayNotBeToldAreSomeone(): void {
    $assigner = $this->recipient('b', 'hidden-assigner-b');
    $creator = $this->recipient('b', 'hidden-creator-b');
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned']);
    $this->ticket('a')->set('owner_user_id', $creator->id())->save();

    $this->actingAs($assigner, fn () => $this->ticket('a')->set('assignee_user_id', $assignee->id())->save());

    $email = $this->mailsTo($assignee)[0];
    self::assertStringEndsWith('] Someone assigned you to this ticket, created by Someone', (string) $email->getSubject());
    foreach (['hidden-assigner-b', 'hidden-creator-b'] as $hidden) {
      self::assertStringNotContainsString($hidden, $email->toString());
    }
  }

  /**
   * A creator whose account is gone is bakers.build.
   */
  public function testDanglingCreatorIsBakersBuild(): void {
    $assigner = $this->recipient('a', 'assigner-a');
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned']);
    $this->ticket('a')->set('owner_user_id', 999999)->save();

    $this->actingAs($assigner, fn () => $this->ticket('a')->set('assignee_user_id', $assignee->id())->save());

    self::assertStringEndsWith('] assigner-a assigned you to this ticket, created by bakers.build', (string) $this->mailsTo($assignee)[0]->getSubject());
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
   * Assigning the ticket to yourself is recorded but not mailed to you.
   */
  public function testTheActorAssigningThemselvesIsNotMailed(): void {
    $actor = $this->recipient('a', 'actor-a');
    $this->tick($actor, ['assigned']);
    $this->actingAs($actor, fn () => $this->ticket('a')->set('assignee_user_id', $actor->id())->save());

    self::assertCount(0, $this->mailsTo($actor));
    self::assertSame([[(int) $actor->id()]], $this->assignedAccounts($this->ticket('a')));
  }

  /**
   * Creating a ticket with yourself as assignee is recorded but not mailed.
   */
  public function testCreatingWithYourselfAsAssigneeIsNotMailed(): void {
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned']);

    $ticket = NULL;
    $this->actingAs($assignee, function () use ($assignee, &$ticket): void {
      $ticket = $this->createEntity('bb_ticket', [
        'title' => 'fresh-assigned',
        'workflow' => 'bb_work',
        'project_id' => $this->fixture('a', 'bb_project')->id(),
        'owner_user_id' => $assignee->id(),
        'assignee_user_id' => $assignee->id(),
      ]);
    });

    self::assertCount(0, $this->mailsTo($assignee));
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertSame([[(int) $assignee->id()]], $this->assignedAccounts($ticket));
  }

  /**
   * Assigning your own conductor makes you assignee without a mail.
   */
  public function testAssigningYourOwnConductorIsNotMailed(): void {
    $owner = $this->recipient('a', 'owner-a');
    $this->tick($owner, ['assigned']);
    $conductor = $this->createEntity('bb_conductor', [
      'conductor_id' => 'node-own',
      'label' => 'node-own',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'machine' => $this->fixture('a', 'bb_machine')->id(),
      'owner_user_id' => $owner->id(),
    ]);

    $this->actingAs($owner, fn () => $this->ticket('a')->set('conductor_id', $conductor->id())->save());

    self::assertCount(0, $this->mailsTo($owner));
    self::assertSame([[(int) $owner->id()]], $this->assignedAccounts($this->ticket('a')));
  }

  /**
   * Another account creating with an assignee mails assignment, not creation.
   */
  public function testCreatingWithAnotherAssigneeSendsTheAssignmentMailOnly(): void {
    $creator = $this->recipient('a', 'creator-a');
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($assignee, ['assigned', 'created']);

    $this->actingAs($creator, fn () => $this->createEntity('bb_ticket', [
      'title' => 'fresh-assigned',
      'workflow' => 'bb_work',
      'project_id' => $this->fixture('a', 'bb_project')->id(),
      'owner_user_id' => $creator->id(),
      'assignee_user_id' => $assignee->id(),
    ]));

    $subjects = array_map(static fn ($email): string => (string) $email->getSubject(), $this->mailsTo($assignee));
    self::assertCount(1, $subjects);
    self::assertStringEndsWith('] creator-a assigned you to their ticket', $subjects[0]);
  }

  /**
   * The accounts of each `assigned` row of a ticket, oldest first.
   *
   * @return list<list<int>>
   *   Account IDs per row.
   */
  private function assignedAccounts(BbTicketInterface $ticket): array {
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $ids = $storage->getQuery()->accessCheck(FALSE)
      ->condition('ticket_id', $ticket->id())
      ->condition('kind', 'assigned')
      ->sort('id')
      ->execute();
    $rows = array_filter($storage->loadMultiple($ids), static fn ($row): bool => $row instanceof BbActivity);
    return array_values(array_map(
      static fn (BbActivity $row): array => array_values(array_map(static fn (array $item): int => (int) $item['target_id'], $row->get('accounts')->getValue())),
      $rows,
    ));
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
