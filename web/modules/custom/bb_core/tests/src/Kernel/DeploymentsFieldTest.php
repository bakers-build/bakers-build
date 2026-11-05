<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * A ticket lists the deployment tickets that carry it.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class DeploymentsFieldTest extends BakersToolTestBase {

  /**
   * Deployments referencing a ticket are listed oldest first; others are not.
   */
  public function testListsReferencingDeploymentsOnly(): void {
    $deployment = $this->term('type', 'deployment')->id();
    $ticket = $this->ticket('DF-T');
    $unreferenced = $this->ticket('DF-U');
    $first = $this->ticket('DF-D1', ['ticket_type' => $deployment, 'referenced_tickets' => [$ticket->id()]]);
    $second = $this->ticket('DF-D2', [
      'ticket_type' => $deployment,
      'referenced_tickets' => [$unreferenced->id(), $ticket->id()],
    ]);
    $this->ticket('DF-F', [
      'ticket_type' => $this->term('type', 'feature')->id(),
      'referenced_tickets' => [$ticket->id()],
    ]);

    $ids = array_column($this->reload($ticket)->get('deployments')->getValue(), 'target_id');
    self::assertSame([(int) $first->id(), (int) $second->id()], array_map('intval', $ids));
    $ids = array_column($this->reload($unreferenced)->get('deployments')->getValue(), 'target_id');
    self::assertSame([(int) $second->id()], array_map('intval', $ids));
    self::assertTrue($this->reload($first)->get('deployments')->isEmpty());
  }

}
