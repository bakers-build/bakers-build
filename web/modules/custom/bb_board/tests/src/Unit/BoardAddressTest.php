<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_board\Unit;

use Drupal\bb_board\BoardAddress;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Facet toggles, parent exclusivity, Clear filters and the Done chip.
 */
#[Group('bb_core')]
final class BoardAddressTest extends UnitTestCase {

  /**
   * No work_state query treats the three open columns as on.
   */
  public function testWorkStateDefaultsToTheOpenColumns(): void {
    $address = new BoardAddress('/board', ['parent_id' => 'abc'], ['parent_id' => 'abc']);
    self::assertSame(BoardAddress::OPEN_WORK_STATES, $address->active('work_state'));
    self::assertFalse($address->showsDone());
  }

  /**
   * Turning Done off when the three open columns remain drops work_state.
   */
  public function testDisablingDoneDropsWorkStateWhenOpenColumnsRemain(): void {
    $address = new BoardAddress('/board', [
      'parent_id' => 'abc',
      'work_state' => ['not_assigned', 'intake', 'working', 'done'],
    ], [
      'parent_id' => 'abc',
      'work_state' => ['not_assigned', 'intake', 'working', 'done'],
    ]);
    self::assertSame('/board?parent_id=abc', $address->toggle('work_state', 'done'));
  }

  /**
   * Turning Done on writes the three open states plus done and drops pagers.
   */
  public function testEnablingDoneWritesOpenStatesAndDone(): void {
    $address = new BoardAddress('/board', [
      'parent_id' => 'abc',
      'page' => '1,0,0,0',
      'state' => ['coding'],
    ], ['state' => ['coding'], 'parent_id' => 'abc']);
    self::assertSame(
      '/board?parent_id=abc&state%5B0%5D=coding&work_state%5B0%5D=not_assigned&work_state%5B1%5D=intake&work_state%5B2%5D=working&work_state%5B3%5D=done',
      $address->toggle('work_state', 'done'),
    );
  }

  /**
   * Turning an open work state off materializes the remaining two.
   */
  public function testTurningOffAnOpenWorkStateKeepsTheOthers(): void {
    $address = new BoardAddress('/board', ['parent_id' => 'abc'], ['parent_id' => 'abc']);
    self::assertSame(
      '/board?parent_id=abc&work_state%5B0%5D=not_assigned&work_state%5B1%5D=intake',
      $address->toggle('work_state', 'working'),
    );
  }

  /**
   * An explicit work_state list is what shows Done.
   */
  public function testShowsDoneReadsTheWorkStateList(): void {
    $hidden = new BoardAddress('/board', ['work_state' => ['working']]);
    self::assertFalse($hidden->showsDone());
    $visible = new BoardAddress('/board', [
      'work_state' => ['not_assigned', 'intake', 'working', 'done'],
    ], [
      'work_state' => ['not_assigned', 'intake', 'working', 'done'],
    ]);
    self::assertTrue($visible->showsDone());
  }

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
   * Parent chips replace each other; the active parent clears.
   */
  public function testParentToggleIsExclusive(): void {
    $address = new BoardAddress('/board', ['state' => ['coding']], ['state' => ['coding']]);
    self::assertSame('/board?state%5B0%5D=coding&parent_id=aaa', $address->toggle('parent_id', 'aaa'));

    $focused = new BoardAddress('/board', [
      'parent_id' => 'aaa',
      'state' => ['coding'],
    ], ['parent_id' => 'aaa', 'state' => ['coding']]);
    self::assertSame('/board?state%5B0%5D=coding&parent_id=bbb', $focused->toggle('parent_id', 'bbb'));
    self::assertSame('/board?state%5B0%5D=coding', $focused->toggle('parent_id', 'aaa'));
  }

  /**
   * Clear filters keeps parent, drops work_state so the open chips return.
   */
  public function testClearKeepsParentAndDropsWorkState(): void {
    $address = new BoardAddress('/board', [
      'parent_id' => 'abc',
      'state' => ['review'],
      'work_state' => ['working', 'done'],
      'page' => '0,1',
    ], [
      'parent_id' => 'abc',
      'state' => ['review'],
      'work_state' => ['working', 'done'],
    ]);
    self::assertSame('/board?parent_id=abc', $address->clear());

    $only_parent = new BoardAddress('/board', ['parent_id' => 'abc'], ['parent_id' => 'abc']);
    self::assertNull($only_parent->clear());
  }

  /**
   * The three open work states are the default, so they are not a deviation.
   */
  public function testClearIgnoresDefaultOpenWorkState(): void {
    $open = new BoardAddress('/board', [
      'parent_id' => 'abc',
      'work_state' => ['not_assigned', 'intake', 'working'],
    ], [
      'parent_id' => 'abc',
      'work_state' => ['not_assigned', 'intake', 'working'],
    ]);
    self::assertNull($open->clear());

    $associative = new BoardAddress('/board', [
      'work_state' => [
        'not_assigned' => 'not_assigned',
        'intake' => 'intake',
        'working' => 'working',
      ],
    ]);
    self::assertNull($associative->clear());

    $with_state = new BoardAddress('/board', [
      'parent_id' => 'abc',
      'state' => ['review'],
      'work_state' => ['not_assigned', 'intake', 'working'],
    ], [
      'parent_id' => 'abc',
      'state' => ['review'],
      'work_state' => ['not_assigned', 'intake', 'working'],
    ]);
    self::assertSame('/board?parent_id=abc', $with_state->clear());
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
   * Title and work state are no longer clearable filters.
   */
  public function testTitleAndWorkStateAreNotClearable(): void {
    self::assertNull((new BoardAddress('/board', ['title' => 'x', 'work_state' => ['done']]))->clear());
  }

}
