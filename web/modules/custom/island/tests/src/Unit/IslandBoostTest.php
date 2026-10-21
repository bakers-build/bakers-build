<?php

declare(strict_types=1);

namespace Drupal\Tests\island\Unit;

use Drupal\island\IslandBoost;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Tests that one list of island ids produces every attribute (BB-408 D1).
 *
 * The class under test writes no attribute itself — core's Htmx does. What is
 * tested here is the only thing IslandBoost owns: the derivation. htmx merges
 * `hx-headers` per key but takes `hx-select-oob` closest-wins, so the two
 * declarations of one fact behave differently under nesting and must never be
 * authored separately. These tests read both attributes out of the same build
 * and compare them, so a change that fed them from two places fails here rather
 * than in a browser six months later.
 */
#[Group('island')]
final class IslandBoostTest extends UnitTestCase {

  /**
   * Reads one rendered htmx attribute off a build, or NULL when unwritten.
   */
  private function attribute(array $build, string $name): ?string {
    $attributes = $build['#attributes'] ?? [];
    if (!isset($attributes['data-hx-' . $name])) {
      return NULL;
    }
    return (string) $attributes['data-hx-' . $name];
  }

  /**
   * A container declaring another island's target rides along with itself.
   */
  public function testOwnIdIsDeclaredWhenTargetingAnotherContainer(): void {
    $build = ['#attributes' => ['id' => 'island-tasks-chrome']];
    IslandBoost::to('#island-tasks-content')->applyTo($build);

    $this->assertSame('true', $this->attribute($build, 'boost'));
    $this->assertSame('#island-tasks-content', $this->attribute($build, 'target'));
    $this->assertSame('#island-tasks-chrome', $this->attribute($build, 'select-oob'));
    $this->assertSame(
      '{"X-Island-Also":"island-tasks-chrome"}',
      $this->attribute($build, 'headers'),
    );
  }

  /**
   * The two declarations are one list: every id appears in both, in one order.
   */
  public function testBothDeclarationsCarryTheSameIdsInTheSameOrder(): void {
    $build = ['#attributes' => ['id' => 'island-tasks-chrome']];
    IslandBoost::to('#island-tasks-content')
      ->also('island-tasks-task_count')
      ->applyTo($build);

    $selectors = explode(',', (string) $this->attribute($build, 'select-oob'));
    $decoded = json_decode((string) $this->attribute($build, 'headers'), TRUE);
    $header_ids = explode(',', $decoded['X-Island-Also']);

    $this->assertSame(['#island-tasks-chrome', '#island-tasks-task_count'], $selectors);
    $this->assertSame(['island-tasks-chrome', 'island-tasks-task_count'], $header_ids);
    // The selectors are the header's ids with '#' in front, positionally. This
    // is the assertion that fails if the two are ever fed from two places.
    $this->assertSame($selectors, array_map(static fn(string $id): string => '#' . $id, $header_ids));
  }

  /**
   * A container that targets itself declares nothing out of band.
   *
   * An island does not ride along with itself: it is already the main fragment.
   * This is the content island's case, and it is what makes a content click
   * cost exactly one island.
   */
  public function testTargetingItselfWritesNeitherOutOfBandAttribute(): void {
    $build = ['#attributes' => ['id' => 'island-tasks-content']];
    IslandBoost::to()->applyTo($build);

    $this->assertSame('true', $this->attribute($build, 'boost'));
    $this->assertSame('#island-tasks-content', $this->attribute($build, 'target'));
    $this->assertNull($this->attribute($build, 'select-oob'));
    $this->assertNull($this->attribute($build, 'headers'));
  }

  /**
   * A self-targeting container may still name a third island.
   */
  public function testTargetingItselfStillHonoursAnExplicitThirdIsland(): void {
    $build = ['#attributes' => ['id' => 'island-tasks-content']];
    IslandBoost::to()->also('island-tasks-task_count')->applyTo($build);

    $this->assertSame('#island-tasks-task_count', $this->attribute($build, 'select-oob'));
    $this->assertSame(
      '{"X-Island-Also":"island-tasks-task_count"}',
      $this->attribute($build, 'headers'),
    );
  }

  /**
   * The swap is outerHTML always, and without ignoreTitle.
   *
   * A boosted element defaults to innerHTML unconditionally — the ternary in
   * htmx ignores the configured default — so an island wrapper that is its own
   * target would otherwise be swapped into itself. There is no switch because
   * this is a correctness requirement and not a preference.
   */
  public function testSwapIsAlwaysOuterHtml(): void {
    foreach ([NULL, '#island-tasks-content'] as $target) {
      $build = ['#attributes' => ['id' => 'island-tasks-chrome']];
      IslandBoost::to($target)->applyTo($build);
      $this->assertSame('outerHTML', $this->attribute($build, 'swap'));
    }
  }

  /**
   * The container's own id is never repeated when also() names it too.
   */
  public function testTheOwnIdIsNotDeclaredTwice(): void {
    $build = ['#attributes' => ['id' => 'island-tasks-chrome']];
    IslandBoost::to('#island-tasks-content')
      ->also('island-tasks-chrome')
      ->applyTo($build);

    $this->assertSame('#island-tasks-chrome', $this->attribute($build, 'select-oob'));
    $this->assertSame(
      '{"X-Island-Also":"island-tasks-chrome"}',
      $this->attribute($build, 'headers'),
    );
  }

  /**
   * A build with no id cannot be boosted.
   *
   * The author never repeats the id, so the id has to be there to be read.
   */
  public function testBuildWithoutAnIdIsRejected(): void {
    $build = ['#type' => 'container'];
    $this->expectException(\LogicException::class);
    IslandBoost::to()->applyTo($build);
  }

}
