<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Hook\WriteAuditHooks;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;
use Psr\Log\LoggerInterface;

/**
 * Unit tests for WriteAuditHooks.
 *
 * Verifies that entity insert events on bakers.build entity types are logged with the
 * correct context, and that non-bakers.build entities are silently ignored.
 */
#[Group('bb_core')]
final class WriteAuditHooksTest extends UnitTestCase {

  /**
   * Verifies that inserting a bakers.build ticket triggers exactly one log entry.
   *
   * The log entry must contain entity type, operation, and current user ID.
   */
  public function testTicketInsertLogged(): void {
    $logger = $this->createMock(LoggerInterface::class);
    $logger->expects($this->once())->method('info')
      ->with(
        $this->stringContains('@entity_type'),
        $this->callback(fn (array $context): bool =>
          $context['@entity_type'] === 'bb_ticket'
          && $context['@op'] === 'insert'
          && $context['@uid'] === 7
        ),
      );
    $account = $this->createMock(AccountInterface::class);
    $account->method('id')->willReturn(7);

    $ticket = $this->createMock(BbTicketInterface::class);
    $ticket->method('getEntityTypeId')->willReturn('bb_ticket');
    $ticket->method('id')->willReturn(12);
    $ticket->method('uuid')->willReturn('aaaa-bbbb');

    $hooks = new WriteAuditHooks($logger, $account);
    $hooks->entityInsert($ticket);
  }

  /**
   * Verifies that inserting a non-bakers.build entity produces no log entry.
   */
  public function testNonBbEntityIgnored(): void {
    $logger = $this->createMock(LoggerInterface::class);
    $logger->expects($this->never())->method('info');
    $account = $this->createMock(AccountInterface::class);

    $node = $this->createMock(EntityInterface::class);
    $node->method('getEntityTypeId')->willReturn('node');

    $hooks = new WriteAuditHooks($logger, $account);
    $hooks->entityInsert($node);
  }

}
