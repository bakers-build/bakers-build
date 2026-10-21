<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\Core\Logger\RfcLogLevel;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Symfony\Component\Mailer\Exception\TransportException;

/**
 * A mail reaches only an account that can take it, and never fails a write.
 *
 * It is branded and shows only what the recipient may see.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityMailDeliveryTest extends ActivityMailKernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = [
    'system', 'user', 'options', 'entity', 'state_machine',
    'link', 'text', 'field', 'og', 'file', 'image', 'serialization', 'jsonapi',
    'bb_core', 'bb_activity', 'bb_activity_test',
  ];

  /**
   * A reader of side a's ticket with status mail ticked.
   */
  private UserInterface $watcher;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->container->get('state')->set('bb_activity_test.ticket_event', TRUE);
    $this->watcher = $this->recipient('a', 'watcher-a');
    $this->tick($this->watcher, ['test_ticket_event']);
  }

  /**
   * The kind that records a row sends it; a row stored any other way does not.
   */
  public function testOnlyTheRecordingKindSendsMail(): void {
    $this->container->get('entity_type.manager')->getStorage('bb_activity')->create([
      'ticket_id' => $this->ticket('a')->id(),
      'kind' => 'test_ticket_event',
    ])->save();
    self::assertSame(0, $this->transport->attempts);

    $this->changeState();
    self::assertCount(1, $this->mailsTo($this->watcher));
  }

  /**
   * A blocked account gets nothing.
   */
  public function testBlockedAccountGetsNothing(): void {
    $this->watcher->block()->save();
    $this->changeState();
    self::assertSame(0, $this->transport->attempts);
  }

  /**
   * An account without an address is skipped without an error.
   */
  public function testAnAccountWithoutAddressIsSkipped(): void {
    $this->watcher->setEmail('')->save();
    $this->changeState();
    self::assertSame(0, $this->transport->attempts);
    self::assertSame([], $this->logs->messages('bb_activity', RfcLogLevel::ERROR));
  }

  /**
   * A transport failure is logged, the write stands, and nothing retries it.
   */
  public function testTransportFailureIsLoggedAndNotRetried(): void {
    $this->transport->failure = new TransportException('Connection refused.');
    $this->changeState();
    self::assertSame('spec', $this->storedState());
    self::assertSame(1, $this->transport->attempts);
    self::assertNotSame([], $this->logs->messages('bb_activity', RfcLogLevel::WARNING));

    $this->transport->failure = NULL;
    $this->ticket('a')->set('title', 'renamed')->save();
    self::assertSame(1, $this->transport->attempts, 'A later write does not resend the failed mail.');
    self::assertSame(0, $this->queuedItems());
  }

  /**
   * A kind failing to build its mail fails neither the write nor other mails.
   */
  public function testKindErrorNeverFailsTheWriteNorOtherMails(): void {
    $this->container->get('state')->set('bb_activity_test.break', TRUE);
    $this->tick($this->watcher, ['test_broken', 'test_ticket_event']);
    $this->changeState();
    self::assertSame('spec', $this->storedState());
    self::assertCount(1, $this->mailsTo($this->watcher));
    $errors = $this->logs->messages('bb_activity', RfcLogLevel::ERROR);
    self::assertCount(1, $errors);
    self::assertStringContainsString('Broken on purpose.', $errors[0]);
  }

  /**
   * The mail is branded HTML with a plain-text part and two action links.
   */
  public function testTheMailIsBrandedHtmlWithPlainTextPart(): void {
    $this->changeState();
    $email = $this->mailsTo($this->watcher)[0];
    self::assertStringContainsString('multipart/alternative', $email->toString());
    $text = (string) $email->getTextBody();
    self::assertStringContainsString('Open the ticket: ' . $this->ticket('a')->toUrl('canonical', ['absolute' => TRUE])->toString(), $text);
    self::assertStringContainsString('/user/' . $this->watcher->id() . '/notifications', $text);
    self::assertStringContainsString($this->ticket('a')->getIdentifier() . ': ticket-a', (string) $email->getHtmlBody());
  }

  /**
   * A title with markup stays literal in the subject and escaped in HTML.
   */
  public function testTitleWithMarkupStaysTextInTheSubjectAndEscapedInHtml(): void {
    $this->ticket('a')->set('title', '<b>R&D</b> plan')->save();
    $this->changeState();
    $email = $this->mailsTo($this->watcher)[0];
    self::assertStringNotContainsString('&amp;', (string) $email->getSubject());
    self::assertStringContainsString('<b>R&D</b> plan', (string) $email->getTextBody());
    self::assertStringNotContainsString('<b>R&D</b>', (string) $email->getHtmlBody());
  }

  /**
   * No mail names the person who made the change.
   */
  public function testNoMailNamesTheActor(): void {
    $actor = $this->recipient('a', 'distinctive-actor');
    $this->container->get('account_switcher')->switchTo($actor);
    try {
      $this->changeState();
    }
    finally {
      $this->container->get('account_switcher')->switchBack();
    }

    self::assertNotSame([], $this->transport->sent);
    foreach ($this->transport->sent as $email) {
      self::assertStringNotContainsString('distinctive-actor', $email->toString());
    }
  }

  /**
   * Moves side a's ticket to spec.
   */
  private function changeState(): void {
    $this->ticket('a')->set('state', 'spec')->save();
  }

  /**
   * The stored state of side a's ticket.
   */
  private function storedState(): string {
    $ticket = $this->container->get('entity_type.manager')->getStorage('bb_ticket')->loadUnchanged($this->ticket('a')->id());
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    return (string) $ticket->get('state')->value;
  }

  /**
   * Items any bb_activity queue holds; there is none to hold them.
   */
  private function queuedItems(): int {
    $database = $this->container->get('database');
    if (!$database->schema()->tableExists('queue')) {
      return 0;
    }
    return (int) $database->select('queue', 'q')
      ->condition('name', 'bb_activity%', 'LIKE')
      ->countQuery()
      ->execute()
      ->fetchField();
  }

}
