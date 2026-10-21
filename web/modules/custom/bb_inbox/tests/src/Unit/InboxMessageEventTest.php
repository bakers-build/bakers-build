<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_inbox\Unit;

use Drupal\Core\Session\AccountInterface;
use Drupal\bb_inbox\Entity\BbInboxMessageInterface;
use Drupal\bb_inbox\Event\InboxMessageEvent;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * One handler claims a message; a second handler cannot take it over.
 */
#[Group('bb_inbox')]
final class InboxMessageEventTest extends UnitTestCase {

  /**
   * A claim by another handler is refused.
   */
  public function testForeignSecondClaimThrows(): void {
    $event = $this->event();
    $event->claim('a', '1');
    $this->expectException(\LogicException::class);
    $event->claim('b', '1');
  }

  /**
   * The same handler may claim again.
   */
  public function testRepeatedClaimBySameHandlerIsAllowed(): void {
    $event = $this->event();
    $event->claim('a', '1');
    $event->claim('a', '1');
    self::assertTrue($event->isClaimed());
    self::assertSame('1', $event->version());
  }

  /**
   * A create event for a stub message and account.
   */
  private function event(): InboxMessageEvent {
    return new InboxMessageEvent(
      $this->createMock(BbInboxMessageInterface::class),
      InboxMessageEvent::OP_CREATE,
      $this->createMock(AccountInterface::class),
    );
  }

}
