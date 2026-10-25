<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_activity\Kernel;

use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\user\UserInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Mail waits for the outermost transaction and never follows a rollback.
 *
 * Run it on MariaDB before a merge that touches the send path as well: the
 * transaction stack is the database driver's.
 */
#[Group('bb_activity')]
#[RunTestsInSeparateProcesses]
final class ActivityMailCommitTest extends ActivityMailKernelTestBase {

  /**
   * A reader of side a's ticket with status mail ticked.
   */
  private UserInterface $watcher;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->watcher = $this->recipient('a', 'watcher-a');
    $this->container->get('state')->set('bb_activity_test.ticket_event', TRUE);
    $this->tick($this->watcher, ['test_ticket_event']);
  }

  /**
   * Inside an outer transaction, the mail goes out at its commit.
   */
  public function testTheMailWaitsForTheOutermostCommit(): void {
    $transaction = $this->container->get('database')->startTransaction();
    $this->ticket('a')->set('state', 'plan')->save();
    self::assertCount(0, $this->mailsTo($this->watcher), 'Nothing is sent while the write is open.');
    $transaction->commitOrRelease();
    unset($transaction);
    self::assertCount(1, $this->mailsTo($this->watcher));
  }

  /**
   * A rolled-back write sends nothing.
   */
  public function testRolledBackWriteSendsNothing(): void {
    $transaction = $this->container->get('database')->startTransaction();
    $this->ticket('a')->set('state', 'plan')->save();
    $transaction->rollBack();
    unset($transaction);
    self::assertSame(0, $this->transport->attempts);
    // loadUnchanged() may answer from the persistent entity cache, which a
    // rollback does not undo; reset it to read the database.
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_ticket');
    $storage->resetCache([$this->ticket('a')->id()]);
    $ticket = $storage->load($this->ticket('a')->id());
    self::assertInstanceOf(BbTicketInterface::class, $ticket);
    self::assertSame('qualification', $ticket->get('state')->value);
  }

  /**
   * A savepoint that rolls back sends nothing, even if its row was cached.
   */
  public function testAnInnerRollbackSendsNothingEvenWhenTheRowWasCached(): void {
    $database = $this->container->get('database');
    $outer = $database->startTransaction();
    $inner = $database->startTransaction();
    $this->ticket('a')->set('state', 'plan')->save();
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_activity');
    $ids = $storage->getQuery()->accessCheck(FALSE)->condition('kind', 'test_ticket_event')->execute();
    self::assertCount(1, $ids);
    // Loading the row fills the persistent entity cache, which a rollback
    // does not undo.
    $storage->load(reset($ids));
    $inner->rollBack();
    unset($inner);
    $outer->commitOrRelease();
    unset($outer);
    self::assertSame(0, $this->transport->attempts);
  }

}
