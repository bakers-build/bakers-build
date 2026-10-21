<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\Logger\RfcLogLevel;
use Drupal\bb_core\Entity\BbConductorInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Who gets an activity mail, and how many, as the write happens.
 *
 * The shipped ticket kinds offer no mail for now; the test kind of
 * bb_activity_test names every account as a recipient, so the mailer's own
 * rules (opt-in, active, address, ticket access) are exercised through it.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityMailRecipientsTest extends ActivityMailKernelTestBase {

  use ActivityKindTestTrait;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->container->get('state')->set('bb_activity_test.ticket_event', TRUE);
  }

  /**
   * An owner who ticked the kind gets one mail naming ticket and link.
   */
  public function testTheOwnerGetsOneMailWhenTheirTicketChangesState(): void {
    $owner = $this->recipient('a', 'owner-a');
    $ticket = $this->ticket('a');
    $ticket->set('owner_user_id', $owner->id())->save();
    $this->tick($owner, ['test_ticket_event']);

    $ticket->set('state', 'spec')->save();

    $mails = $this->mailsTo($owner);
    self::assertCount(1, $mails);
    self::assertStringContainsString('[' . $ticket->getIdentifier() . '] A test ticket event happened', (string) $mails[0]->getSubject());
    $text = (string) $mails[0]->getTextBody();
    self::assertStringContainsString('ticket-a', $text);
    self::assertStringContainsString($ticket->toUrl('canonical', ['absolute' => TRUE])->toString(), $text);
  }

  /**
   * A kind that words no mail text mails nobody and logs nothing.
   */
  public function testKindWithoutMailTextMailsNobody(): void {
    $owner = $this->recipient('a', 'owner-a');
    $ticket = $this->ticket('a');
    $ticket->set('owner_user_id', $owner->id())->save();
    $this->tick($owner, ['test_ticket_event']);
    $this->container->get('state')->set('bb_activity_test.feed_only', TRUE);

    $ticket->set('state', 'spec')->save();

    self::assertCount(1, $this->container->get('entity_type.manager')->getStorage('bb_activity')
      ->loadByProperties(['ticket_id' => $ticket->id(), 'kind' => 'test_ticket_event']));
    self::assertSame([], $this->transport->sent);
    foreach ([RfcLogLevel::ERROR, RfcLogLevel::WARNING, RfcLogLevel::NOTICE] as $level) {
      self::assertSame([], $this->logs->messages('bb_activity', $level));
    }
  }

  /**
   * The person who made the change is mailed too.
   */
  public function testTheActorIsNotExcluded(): void {
    $owner = $this->recipient('a', 'owner-a');
    $ticket = $this->ticket('a');
    $ticket->set('owner_user_id', $owner->id())->save();
    $this->tick($owner, ['test_ticket_event']);
    $this->container->get('account_switcher')->switchTo($owner);
    try {
      $ticket->set('state', 'spec')->save();
    }
    finally {
      $this->container->get('account_switcher')->switchBack();
    }
    self::assertCount(1, $this->mailsTo($owner));
  }

  /**
   * A team member gets "other tickets" mail only with the box ticked.
   */
  public function testTeamMemberGetsOtherTicketMailOnlyWhenTicked(): void {
    $watcher = $this->recipient('a', 'watcher-a');
    $quiet = $this->recipient('a', 'quiet-a');
    $this->tick($watcher, ['test_ticket_event']);

    $this->ticket('a')->set('state', 'spec')->save();

    self::assertCount(1, $this->mailsTo($watcher));
    self::assertCount(0, $this->mailsTo($quiet));
  }

  /**
   * An account that cannot view the ticket gets nothing, whatever it ticked.
   */
  public function testAnAccountThatCannotSeeTheTicketGetsNothing(): void {
    $outsider = $this->recipient('b', 'outsider-b');
    $this->tick($outsider, ['test_ticket_event']);

    $this->ticket('a')->set('state', 'spec')->save();

    self::assertCount(0, $this->mailsTo($outsider));
  }

  /**
   * The shipped ticket kinds offer no mail, even for an account that ticked it.
   */
  public function testTheShippedTicketKindsSendNoMail(): void {
    $owner = $this->recipient('a', 'owner-a');
    $assignee = $this->recipient('a', 'assignee-a');
    $this->tick($owner, [
      'created', 'status_changed', 'claimed', 'run_ended',
    ]);

    $ticket = $this->freshTicket('a', $owner, $assignee);
    $ticket->set('state', 'spec')->save();
    [$run, $conductor] = $this->claimedRun($ticket);
    $this->claimed($ticket, $run, $conductor);
    $run->set('state', 'failed')->save();

    self::assertCount(0, $this->mailsTo($owner));
    self::assertCount(0, $this->mailsTo($assignee));
    self::assertSame([], $this->transport->sent);
  }

  /**
   * A new ticket in a side's project, owned (and optionally assigned).
   */
  private function freshTicket(string $side, UserInterface $owner, ?UserInterface $assignee = NULL): BbTicketInterface {
    $ticket = $this->createEntity('bb_ticket', [
      'title' => "fresh-$side",
      'workflow' => 'bb_feature',
      'project_id' => $this->fixture($side, 'bb_project')->id(),
      'owner_user_id' => $owner->id(),
      'assignee_user_id' => $assignee?->id(),
    ]);
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return $ticket;
  }

  /**
   * A claimed run of the ticket on its side's conductor, started in coding.
   *
   * @return array{0: \Drupal\bb_core\Entity\BbRunInterface, 1: \Drupal\bb_core\Entity\BbConductorInterface}
   *   The run and its conductor.
   */
  private function claimedRun(BbTicketInterface $ticket): array {
    $conductor = $this->fixture('a', 'bb_conductor');
    self::assertInstanceOf(BbConductorInterface::class, $conductor);
    $run = $this->createEntity('bb_run', [
      'conductor_id' => $conductor->id(),
      'ticket_id' => $ticket->id(),
      'state' => 'claimed',
      'state_at_start' => 'coding',
      'claim_expires_at' => 2147483000,
    ]);
    self::assertInstanceOf(BbRunInterface::class, $run);
    return [$run, $conductor];
  }

}
