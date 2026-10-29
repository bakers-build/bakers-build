<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Tool;

use Drupal\Core\Entity\ContentEntityInterface;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * Classification through its tool sets recipe and type by name.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketClassifyToolTest extends BakersToolTestBase {

  /**
   * Reuses an existing term and creates a missing one in the workspace.
   */
  public function testClassifyReusesAndCreatesTerms(): void {
    $type = $this->term('type', 'feature');
    $ticket = $this->ticket('TK-1');
    $out = $this->outputs($this->runTool('bakers_ticket_classify', [
      'ticket' => $ticket->getIdentifier(),
      'recipe' => 'matt',
      'type' => 'feature',
    ]));
    self::assertSame(['type' => 'feature', 'recipe' => 'matt'], $out);
    $stored = $this->reload($ticket);
    self::assertSame($type->id(), $stored->get('ticket_type')->target_id);
    $recipe = $stored->get('recipe')->entity;
    self::assertInstanceOf(ContentEntityInterface::class, $recipe);
    self::assertSame('matt', $recipe->label());
    self::assertSame($this->workspace->id(), $recipe->get('workspace_id')->target_id);
  }

  /**
   * A call with neither recipe nor type is refused.
   */
  public function testNeitherRecipeNorTypeFails(): void {
    $ticket = $this->ticket('TK-2');
    $this->assertFailure($this->runTool('bakers_ticket_classify', [
      'ticket' => $ticket->getIdentifier(),
    ]), 'recipe or a type');
  }

}
