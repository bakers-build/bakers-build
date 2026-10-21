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
   * Done attaches only when work_state names it.
   *
   * @return array<string, array{mixed, bool}>
   *   Raw work_state query value and whether Done attaches.
   */
  public static function showDoneInput(): array {
    return [
      'done alone' => [['done'], TRUE],
      'done among open' => [['not_assigned', 'intake', 'working', 'done'], TRUE],
      'scalar done' => ['done', TRUE],
      'missing' => [NULL, FALSE],
      'open only' => [['not_assigned', 'intake', 'working'], FALSE],
      'empty' => ['', FALSE],
      'unrelated' => [['1'], FALSE],
    ];
  }

  /**
   * Absent or open-only work_state hides Done.
   */
  #[DataProvider('showDoneInput')]
  public function testDoneAttachesWhenWorkStateNamesIt(mixed $raw, bool $expected): void {
    self::assertSame($expected, BbBoardColumn::showsDone($raw));
  }

}
