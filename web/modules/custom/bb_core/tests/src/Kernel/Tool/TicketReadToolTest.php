<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A ticket read through its tool carries its fields and readable comments.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketReadToolTest extends BakersToolTestBase {

  /**
   * Returns the ticket fields and its comments in chronological order.
   */
  public function testReadReturnsFieldsAndComments(): void {
    $ticket = $this->ticket('TR-1', [
      'description' => ['value' => "## Goal\n", 'format' => 'bb_rich'],
      'ticket_type' => $this->term('type', 'feature')->id(),
      'labels' => [$this->term('label', 'retro')->id(), $this->term('label', 'ui')->id()],
      'links' => [['uri' => 'https://example.com/mr/1', 'title' => 'MR']],
    ]);
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $comment = static fn (string $type, string $body, int $created) => $storage->create([
      'ticket_id' => $ticket->id(),
      'type' => $type,
      'body' => ['value' => $body, 'format' => 'bb_rich'],
      'created' => $created,
    ]);
    $second = $comment('plan', 'second', 2000);
    $second->save();
    $first = $comment('spec', 'first', 1000);
    $first->save();

    $out = $this->outputs($this->runTool('bakers_ticket_read', ['ticket' => $ticket->getIdentifier()]));

    self::assertSame($ticket->uuid(), $out['id']);
    self::assertSame($ticket->getIdentifier(), $out['identifier']);
    self::assertSame('TR-1', $out['title']);
    self::assertSame('qualification', $out['state']);
    self::assertSame('bb_work', $out['workflow']);
    self::assertSame("## Goal\n", $out['description']);
    self::assertSame('feature', $out['type']);
    self::assertNull($out['recipe'] ?? NULL);
    self::assertSame(['retro', 'ui'], $out['labels']);
    self::assertSame([['uri' => 'https://example.com/mr/1', 'title' => 'MR']], $out['links']);
    self::assertSame([
      ['id' => $first->uuid(), 'type' => 'spec', 'body' => 'first', 'created' => date('c', 1000), 'author' => 'actor'],
      ['id' => $second->uuid(), 'type' => 'plan', 'body' => 'second', 'created' => date('c', 2000), 'author' => 'actor'],
    ], $out['comments']);
  }

  /**
   * An unknown or unreadable ticket is an input error naming it.
   */
  public function testUnreadableTicketFails(): void {
    $id = $this->ticket('TR-2')->getIdentifier();
    $this->assertFailure($this->runTool('bakers_ticket_read', ['ticket' => 'TR-404']), 'TR-404');
    $this->container->get('current_user')->setAccount($this->account('outsider', ['skill_user']));
    $this->assertFailure($this->runTool('bakers_ticket_read', ['ticket' => $id]), $id);
  }

}
