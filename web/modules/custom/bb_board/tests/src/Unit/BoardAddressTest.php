<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Unit;

use Drupal\bb_board\BoardAddress;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Facet toggles, Clear filters and the board toggles.
 */
#[Group('bb_core')]
final class BoardAddressTest extends UnitTestCase {

  /**
   * A state chip accumulates; a second click drops that value.
   */
  public function testStateToggleAccumulatesAndClears(): void {
    $address = new BoardAddress('/board', ['parent_id' => 'abc'], ['parent_id' => 'abc']);
    $on = $address->toggle('state', 'review');
    self::assertSame('/board?parent_id=abc&state%5B0%5D=review', $on);

    $active = new BoardAddress('/board', [
      'parent_id' => 'abc',
      'state' => ['review'],
      'page' => '1',
    ], ['parent_id' => 'abc', 'state' => ['review']]);
    self::assertSame(['review'], $active->active('state'));
    self::assertSame('/board?parent_id=abc', $active->toggle('state', 'review'));
  }

  /**
   * Clear filters keeps the parent and drops the pagers.
   */
  public function testClearKeepsParent(): void {
    $address = new BoardAddress('/board', [
      'parent_id' => 'abc',
      'state' => ['review'],
      'page' => '0,1',
    ], [
      'parent_id' => 'abc',
      'state' => ['review'],
    ]);
    self::assertSame('/board?parent_id=abc', $address->clear());

    $only_parent = new BoardAddress('/board', ['parent_id' => 'abc'], ['parent_id' => 'abc']);
    self::assertNull($only_parent->clear());
  }

  /**
   * The Details toggle sets details, drops pagers and keeps the rest.
   */
  public function testWithDetailsSetsTheParameterAndDropsPage(): void {
    $address = new BoardAddress('/board', ['parent_id' => 'abc', 'page' => '1,0,0,0']);
    self::assertSame('/board?parent_id=abc&details=states', $address->withDetails(TRUE));
    self::assertSame('/board?parent_id=abc&details=phases', $address->withDetails(FALSE));
  }

  /**
   * The Done toggle sets done and drops the pager and the older window.
   */
  public function testWithDoneSetsTheParameterAndDropsPageAndOlder(): void {
    $address = new BoardAddress('/board', ['page' => '0,0,0,1', 'done_older' => '1']);
    self::assertSame('/board?done=hide', $address->withDone(FALSE));
    self::assertSame('/board?done=show', $address->withDone(TRUE));
  }

  /**
   * Show older asks for the whole Done column and drops pagers.
   */
  public function testWithOlderSetsDoneOlder(): void {
    $address = new BoardAddress('/board', ['parent_id' => 'abc', 'page' => '0,0,0,1']);
    self::assertSame('/board?parent_id=abc&done_older=1', $address->withOlder());
  }

  /**
   * Clear filters removes search and health and keeps the parent.
   */
  public function testClearRemovesSearchAndHealthAndKeepsParent(): void {
    $query = ['parent_id' => 'abc', 'search' => 'login', 'health' => 'unhealthy', 'details' => 'states'];
    self::assertSame('/board?parent_id=abc', (new BoardAddress('/board', $query))->clear());
    self::assertSame('/board', (new BoardAddress('/board', ['health' => 'unhealthy']))->clear());
  }

  /**
   * A chip's removal drops its whole filter and the pagers, nothing else.
   */
  public function testWithoutDropsOneWholeFilterAndThePagers(): void {
    $address = new BoardAddress('/board', [
      'parent_id' => 'abc',
      'state' => ['review', 'coding'],
      'health' => 'unhealthy',
      'page' => '0,1',
    ]);
    self::assertSame('/board?parent_id=abc&health=unhealthy', $address->without('state'));
    self::assertSame('/board?parent_id=abc&state%5B0%5D=review&state%5B1%5D=coding', $address->without('health'));
    self::assertSame('/board', (new BoardAddress('/board', ['parent_id' => 'abc']))->without('parent_id'));
  }

}
