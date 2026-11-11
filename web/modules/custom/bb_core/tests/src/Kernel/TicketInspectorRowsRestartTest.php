<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

use Drupal\bb_core\Ticket\TicketInspectorRows;
use Drupal\Tests\bb_core\Kernel\Tool\BakersToolTestBase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;

/**
 * The inspector's Properties block shows who last restarted a ticket and when.
 */
#[Group('bb_core')]
#[RunTestsInSeparateProcesses]
final class TicketInspectorRowsRestartTest extends BakersToolTestBase {

  /**
   * A restarted ticket shows a Restarted row with the restarter and the date.
   */
  public function testRestartedRowShowsWhoAndWhen(): void {
    $at = $this->container->get('datetime.time')->getRequestTime() - 3600;
    $ticket = $this->ticket('IR-R', ['restarted_at' => $at, 'restarted_by' => $this->actor->id()]);
    $rows = $this->rows();

    $built = $rows->build($this->reload($ticket));

    self::assertSame(['kind' => 'text', 'value' => 'Restarted', 'emphasis' => 'faint'], $built['restarted_at']['cells']['label']);
    $expected = $this->actor->getDisplayName() . ' · ' . $this->container->get('bb_core.date')->label($at);
    self::assertSame(['kind' => 'text', 'value' => $expected], $built['restarted_at']['cells']['value']);
    self::assertStringContainsString('Restarted', serialize($rows->propertiesBlock($built)));
  }

  /**
   * A ticket never restarted has no Restarted row in its Properties block.
   */
  public function testNoRestartedRowWhenNeverRestarted(): void {
    $rows = $this->rows();
    $block = $rows->propertiesBlock($rows->build($this->reload($this->ticket('IR-N'))));
    self::assertStringNotContainsString('Restarted', serialize($block));
  }

  /**
   * The inspector rows service.
   */
  private function rows(): TicketInspectorRows {
    $rows = $this->container->get('bb_core.ticket_inspector_rows');
    assert($rows instanceof TicketInspectorRows);
    return $rows;
  }

}
