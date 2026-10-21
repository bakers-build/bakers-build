<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_inbox\Kernel;

use Drupal\Core\Access\AccessException;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\bb_inbox\InboxRejected;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Message responsibility, server-set fields, status order and access.
 */
#[Group('bb_inbox')]
#[RunTestsInSeparateProcesses]
final class InboxMessageTest extends KernelTestBase {

  use InboxWorldTrait;

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image',
    'serialization', 'jsonapi', 'jsonapi_resources',
    'bb_core', 'bb_inbox', 'bb_inbox_test',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->buildInboxWorld();
  }

  /**
   * A message nobody is responsible for is rejected.
   */
  public function testNoHandlerRejects(): void {
    $this->expectException(InboxRejected::class);
    $this->expectExceptionMessage('no handler for message nobody.x');
    $this->send($this->guest, 'nobody.x');
  }

  /**
   * Conductor, owner, requester, status and version are set server-side.
   */
  public function testSendSetsServerFields(): void {
    $other = $this->createConductor('node-other', $this->contributor);
    $message = $this->container->get('entity_type.manager')
      ->getStorage('bb_inbox_message')
      ->create([
        'ticket_id' => $this->ticket->id(),
        'message_id' => 'test.echo',
        'conductor_id' => $other->id(),
        'owner_user_id' => $this->contributor->id(),
        'status' => 'done',
      ]);
    self::assertInstanceOf(BbInboxMessageInterface::class, $message);
    $message->save();
    $message = $this->reloadMessage($message);
    self::assertSame((int) $this->conductor->id(), (int) $message->conductor()?->id());
    self::assertSame((int) $this->conductorOwner->id(), (int) $message->getOwnerId());
    self::assertSame('pending', $message->status());

    $sent = $this->reloadMessage($this->send($this->guest, 'test.echo', ['text' => 'hi']));
    self::assertSame('pending', $sent->status());
    self::assertSame('0.0.1', $sent->get('version')->value);
    self::assertSame((int) $this->guest->id(), (int) $sent->get('requested_by')->target_id);
    self::assertSame((int) $this->conductor->id(), (int) $sent->conductor()?->id());
    self::assertSame(['text' => 'hi'], $sent->payload());
  }

  /**
   * A viewer whose collection scope lacks the ticket may still send.
   *
   * Ticket view access and the ticket query's read scope can disagree (a
   * workspace guest outside the project's teams); the sender checked view
   * access explicitly, so the reference check must not reject the message.
   */
  public function testViewerOutsideTheReadScopeCanSend(): void {
    $viewer = $this->createAccount('guest-without-team');
    $this->addMembership($this->fixture('a', 'bb_workspace'), $viewer, ['guest']);
    self::assertTrue($this->ticket->access('view', $viewer), 'Precondition: the viewer may view the ticket.');
    self::assertNotContains((int) $this->ticket->id(), $this->queryIdsAs('bb_ticket', $viewer), 'Precondition: the read scope lacks it.');
    self::assertSame('pending', $this->send($viewer, 'test.echo')->status());
  }

  /**
   * A ticket without conductor cannot receive messages.
   */
  public function testTicketWithoutConductorRejects(): void {
    $this->ticket->set('conductor_id', NULL)->save();
    $this->expectException(InboxRejected::class);
    $this->expectExceptionMessage('has no conductor');
    $this->send($this->guest, 'test.echo');
  }

  /**
   * The responsible handler's veto rejects the message.
   */
  public function testHandlerVetoRejects(): void {
    $this->expectException(InboxRejected::class);
    $this->expectExceptionMessage('payload.bad');
    $this->send($this->guest, 'test.echo', ['bad' => TRUE]);
  }

  /**
   * The responsible handler's denial is an access failure, not a veto.
   */
  public function testHandlerDenyIsAccessDenied(): void {
    $this->expectException(AccessException::class);
    $this->send($this->guest, 'test.echo', ['deny' => TRUE]);
  }

  /**
   * Status moves forward only.
   */
  public function testStatusOrder(): void {
    $message = $this->send($this->guest, 'test.echo');
    self::assertSame([], $this->writeResult($message, 'running', NULL));
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => 'ok']));
    $violations = $this->writeResult($this->reloadMessage($message), 'running', NULL);
    self::assertNotSame([], $violations);
    self::assertStringContainsString('done to running', implode(' ', $violations));
  }

  /**
   * A second result on a terminal message is rejected; the first stays.
   */
  public function testTerminalMessageRejectsSecondResult(): void {
    $message = $this->send($this->guest, 'test.echo');
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => 'first']));
    $violations = $this->writeResult($this->reloadMessage($message), 'done', ['markdown' => 'second']);
    self::assertNotSame([], $violations);
    self::assertSame(['markdown' => 'first'], $this->reloadMessage($message)->result());
  }

  /**
   * Done and failed results are message-result.v2, exactly `{markdown}`.
   */
  public function testTerminalResultShape(): void {
    $message = $this->send($this->guest, 'test.echo');
    self::assertNotSame([], $this->writeResult($message, 'failed', ['rows' => []]));
    $message = $this->reloadMessage($message);
    self::assertNotSame([], $this->writeResult($message, 'failed', ['message' => 'x', 'level' => 'error']), 'The retired failure shape is rejected.');
    $message = $this->reloadMessage($message);
    self::assertNotSame([], $this->writeResult($message, 'done', NULL));
    $message = $this->reloadMessage($message);
    self::assertNotSame([], $this->writeResult($message, 'done', ['rows' => []]));
    $message = $this->reloadMessage($message);
    self::assertNotSame([], $this->writeResult($message, 'done', ['markdown' => 'bad']), 'The handler vetoes the result.');
    $message = $this->reloadMessage($message);
    self::assertSame([], $this->writeResult($message, 'done', ['markdown' => 'x']));
  }

  /**
   * A contract-2 handler fails with its only result shape, {markdown}.
   */
  public function testFailedMarkdownResult(): void {
    $message = $this->send($this->guest, 'test.echo');
    self::assertSame([], $this->writeResult($message, 'failed', ['markdown' => 'no worktree']));
  }

  /**
   * Reassigning the ticket does not move a sent message.
   */
  public function testMessageKeepsConductorCapturedAtSend(): void {
    $message = $this->send($this->guest, 'test.echo');
    $newOwner = $this->createAccount('new-owner', ['register bakers conductor']);
    $new = $this->createConductor('node-new', $newOwner);
    $this->ticket->set('conductor_id', $new->id())->save();
    $fresh = $this->reloadMessage($message);
    $fresh->set('payload', '{"text":"x"}')->save();
    $fresh = $this->reloadMessage($message);
    self::assertSame((int) $this->conductor->id(), (int) $fresh->conductor()?->id());
    self::assertSame((int) $this->conductorOwner->id(), (int) $fresh->getOwnerId());
    $pending = $this->container->get('entity_type.manager')->getStorage('bb_inbox_message')
      ->getQuery()->accessCheck(FALSE)
      ->condition('conductor_id', $new->id())
      ->condition('status', 'pending')
      ->execute();
    self::assertSame([], $pending);
  }

  /**
   * The conductor owner may write status and result only; others nothing.
   */
  public function testConductorUpdateAccessLimitedToStatusAndResult(): void {
    $message = $this->send($this->guest, 'test.echo');
    self::assertTrue($message->access('update', $this->conductorOwner));
    foreach (['status', 'result'] as $field) {
      self::assertTrue($message->get($field)->access('edit', $this->conductorOwner), "$field is writable.");
    }
    foreach (['payload', 'message_id', 'ticket_id', 'conductor_id', 'requested_by', 'version'] as $field) {
      self::assertFalse($message->get($field)->access('edit', $this->conductorOwner), "$field is closed.");
    }
    $foreignOwner = $this->createAccount('foreign-conductor-owner', ['register bakers conductor']);
    $this->createConductor('node-foreign', $foreignOwner);
    self::assertFalse($message->access('update', $foreignOwner));
    self::assertFalse($message->access('update', $this->guest));
    self::assertFalse($message->access('update', $this->contributor));
    self::assertFalse($message->access('delete', $this->conductorOwner));
  }

  /**
   * Only the requester and the conductor owner see the message.
   *
   * BB-661: a co-viewer of the ticket who did not send the request (here
   * `contributor`) must not see it through direct entity access either — a
   * result can be another person's sensitive answer.
   */
  public function testViewAccess(): void {
    $message = $this->send($this->guest, 'test.echo');
    self::assertTrue($message->access('view', $this->guest));
    self::assertFalse($message->access('view', $this->contributor));
    self::assertTrue($message->access('view', $this->conductorOwner));
    self::assertFalse($message->access('view', $this->outsider));
    self::assertContains((int) $message->id(), $this->queryIdsAs('bb_inbox_message', $this->guest));
    self::assertContains((int) $message->id(), $this->queryIdsAs('bb_inbox_message', $this->conductorOwner));
    self::assertNotContains((int) $message->id(), $this->queryIdsAs('bb_inbox_message', $this->contributor));
    self::assertNotContains((int) $message->id(), $this->queryIdsAs('bb_inbox_message', $this->outsider));
  }

  /**
   * Generic create access is closed: only the sender service creates.
   */
  public function testGenericCreateAccessDenied(): void {
    $handler = $this->container->get('entity_type.manager')->getAccessControlHandler('bb_inbox_message');
    self::assertFalse($handler->createAccess(NULL, $this->contributor));
    self::assertFalse($handler->createAccess(NULL, $this->conductorOwner));
  }

}
