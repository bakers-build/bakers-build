<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\bb_core\Entity\BbCommentInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A comment published through its tool is typed Markdown on the ticket.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class CommentPublishToolTest extends BakersToolTestBase {

  /**
   * Stores the Markdown source as bb_rich with the given type.
   */
  public function testPublishStoresTypedMarkdown(): void {
    $ticket = $this->ticket('TL-1');
    $body = "# Plan\n\n- one `step`\n";
    $out = $this->outputs($this->runTool('bakers_comment_publish', [
      'ticket' => $ticket->getIdentifier(),
      'type' => 'plan',
      'body' => $body,
    ]));
    self::assertSame('plan', $out['type']);
    $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_comment', $out['id']);
    self::assertInstanceOf(BbCommentInterface::class, $stored);
    self::assertSame($body, $stored->get('body')->value);
    self::assertSame('bb_rich', $stored->get('body')->format);
    self::assertSame('plan', $stored->get('type')->value);
    self::assertSame($ticket->id(), $stored->get('ticket_id')->target_id);
    self::assertSame($this->actor->id(), $stored->get('author')->target_id);
  }

  /**
   * Each type accepts its byte limit and refuses the next byte atomically.
   */
  public function testCommentByteBudgets(): void {
    $ticket = $this->ticket('TL-budget');
    $storage = $this->container->get('entity_type.manager')->getStorage('bb_comment');
    $budgets = [
      'qualification' => 4096,
      'test' => 4096,
      'debug_diagnose' => 4096,
      'spec' => 6144,
      'plan' => 6144,
      'coding' => 6144,
      'review' => 6144,
      'acceptance' => 3072,
      'summary' => 3072,
      'retro' => 3072,
      'comment' => 8192,
      'custom' => 8192,
      'description' => 8192,
    ];
    foreach ($budgets as $type => $limit) {
      $body = str_repeat('é', intdiv($limit, 2));
      $values = ['ticket' => $ticket->uuid(), 'type' => $type, 'body' => $body];
      $out = $this->outputs($this->runTool('bakers_comment_publish', $values));
      $stored = $this->container->get('entity.repository')->loadEntityByUuid('bb_comment', $out['id']);
      self::assertInstanceOf(BbCommentInterface::class, $stored);
      self::assertSame($body, $stored->get('body')->value);
      $before = $storage->getQuery()->accessCheck(FALSE)->count()->execute();
      $values['body'] .= 'x';
      $this->assertFailure($this->runTool('bakers_comment_publish', $values), sprintf('%s is %d UTF-8 bytes; limit %d', $type, $limit + 1, $limit));
      self::assertSame($before, $storage->getQuery()->accessCheck(FALSE)->count()->execute());
    }
  }

  /**
   * The ticket also resolves by UUID.
   */
  public function testTicketByUuid(): void {
    $ticket = $this->ticket('TL-2');
    $out = $this->outputs($this->runTool('bakers_comment_publish', [
      'ticket' => $ticket->uuid(),
      'type' => 'comment',
      'body' => 'x',
    ]));
    self::assertSame('comment', $out['type']);
  }

  /**
   * A missing or blank body or an unreadable ticket stores nothing.
   */
  public function testInvalidInputStoresNothing(): void {
    $id = $this->ticket('TL-3')->getIdentifier();
    $this->assertFailure($this->runTool('bakers_comment_publish', ['ticket' => $id, 'type' => 'plan']), 'body');
    $blank = ['ticket' => $id, 'type' => 'plan', 'body' => " \t\n\n"];
    $this->assertFailure($this->runTool('bakers_comment_publish', $blank), 'body');
    $missing = ['ticket' => 'TL-404', 'type' => 'plan', 'body' => 'x'];
    $this->assertFailure($this->runTool('bakers_comment_publish', $missing), 'TL-404');
    $this->container->get('current_user')->setAccount($this->account('outsider', ['skill_user']));
    $this->assertFailure($this->runTool('bakers_comment_publish', ['ticket' => $id, 'type' => 'plan', 'body' => 'x']), $id);
    self::assertSame(0, (int) $this->container->get('entity_type.manager')->getStorage('bb_comment')
      ->getQuery()->accessCheck(FALSE)->count()->execute());
  }

}
