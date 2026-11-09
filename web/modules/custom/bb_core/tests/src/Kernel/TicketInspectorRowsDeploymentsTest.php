<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Ticket\TicketInspectorRows;
use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The inspector's Code block shows where a ticket is deployed.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketInspectorRowsDeploymentsTest extends BakersToolTestBase {

  /**
   * One linked chip per environment of each deployment; none when undeployed.
   */
  public function testDeployedToRow(): void {
    $this->installEntitySchema('bb_environment');
    $etm = $this->container->get('entity_type.manager');
    $production = $etm->getStorage('bb_environment')->create([
      'name' => 'production',
      'project_id' => $this->project->id(),
    ]);
    $production->save();
    $type = $this->term('type', 'deployment')->id();
    $ticket = $this->ticket('IR-T');
    $unreferenced = $this->ticket('IR-U');
    $deployment = $this->ticket('IR-D1', [
      'ticket_type' => $type,
      'referenced_tickets' => [$ticket->id()],
      'environments' => [$production->id()],
    ]);
    $this->ticket('IR-D2', ['ticket_type' => $type, 'referenced_tickets' => [$ticket->id()]]);
    $rows = $this->container->get('bb_core.ticket_inspector_rows');
    assert($rows instanceof TicketInspectorRows);

    $built = $rows->build($this->reload($ticket));
    self::assertSame([
      'label' => ['kind' => 'text', 'value' => 'Deployed to', 'emphasis' => 'faint'],
      'value' => [
        'kind' => 'badge',
        'label' => 'production · ' . $deployment->getIdentifier(),
        'tone' => 'neutral',
        'mono' => TRUE,
        'url' => $deployment->toUrl()->toString(),
      ],
    ], $built['deployments']['cells']);
    self::assertStringContainsString('Deployed to', serialize($rows->groupBlock('code', $built)));
    self::assertStringNotContainsString('Deployed to', serialize($rows->groupBlock('code', $rows->build($this->reload($unreferenced)))));
  }

}
