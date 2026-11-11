<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Unit;

use Drupal\bb_board\Plugin\views\display\BbBoardColumn;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Board column attachments paint in lifecycle order.
 */
#[Group('bb_core')]
final class BbBoardColumnTest extends UnitTestCase {

  /**
   * View::preSave() ksorts display ids; the plugin restores lifecycle order.
   */
  public function testAttachmentsSortToLifecycleOrder(): void {
    $sorted = BbBoardColumn::sortAttachments([
      ['#display_id' => 'done'],
      ['#display_id' => 'backlog'],
      ['#display_id' => 'working'],
      ['#display_id' => 'intake'],
    ]);
    self::assertSame(
      ['backlog', 'intake', 'working', 'done'],
      array_column($sorted, '#display_id'),
    );
  }

  /**
   * Unknown display ids stay after the four columns.
   */
  public function testUnknownDisplayIdsStayLast(): void {
    $sorted = BbBoardColumn::sortAttachments([
      ['#display_id' => 'extra'],
      ['#display_id' => 'intake'],
      ['#display_id' => 'backlog'],
    ]);
    self::assertSame(
      ['backlog', 'intake', 'extra'],
      array_column($sorted, '#display_id'),
    );
  }

  /**
   * Details sub-columns paint between Working and Done.
   */
  public function testAttachmentOrderWithDetails(): void {
    $sorted = BbBoardColumn::sortAttachments([
      ['#display_id' => 'done'],
      ['#display_id' => 'working_review'],
      ['#display_id' => 'backlog'],
      ['#display_id' => 'working_plan'],
      ['#display_id' => 'intake'],
      ['#display_id' => 'working_working'],
    ]);
    self::assertSame(
      ['backlog', 'intake', 'working_plan', 'working_working', 'working_review', 'done'],
      array_column($sorted, '#display_id'),
    );
  }

  /**
   * Details on attaches the state sub-columns, off the Working column.
   *
   * @return array<string, array{string, bool, bool}>
   *   Display id, Details on, and whether the display attaches.
   */
  public static function detailsInput(): array {
    return [
      'working, phases' => ['working', FALSE, TRUE],
      'working, states' => ['working', TRUE, FALSE],
      'plan, phases' => ['working_plan', FALSE, FALSE],
      'plan, states' => ['working_plan', TRUE, TRUE],
      'working state, states' => ['working_working', TRUE, TRUE],
      'review, phases' => ['working_review', FALSE, FALSE],
      'review, states' => ['working_review', TRUE, TRUE],
      'not assigned, states' => ['backlog', TRUE, TRUE],
      'intake, phases' => ['intake', FALSE, TRUE],
    ];
  }

  /**
   * Working or its sub-columns attach, never both.
   */
  #[DataProvider('detailsInput')]
  public function testWorkingOrSubColumnsByDetails(string $display, bool $details, bool $expected): void {
    self::assertSame($expected, BbBoardColumn::attaches($display, $details));
  }

  /**
   * Done attaches with Details on and off; it is a column, not a filter.
   */
  public function testDoneAlwaysAttaches(): void {
    self::assertTrue(BbBoardColumn::attaches('done', FALSE));
    self::assertTrue(BbBoardColumn::attaches('done', TRUE));
  }

}
