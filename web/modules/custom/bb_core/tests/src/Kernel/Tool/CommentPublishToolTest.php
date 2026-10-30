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
