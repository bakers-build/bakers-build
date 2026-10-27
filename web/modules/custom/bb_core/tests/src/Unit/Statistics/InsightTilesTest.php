<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit\Statistics;

use Drupal\bb_core\Statistics\Render\InsightTiles;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers the comparison rules of the Insights tiles.
 */
#[Group('bb_core')]
final class InsightTilesTest extends UnitTestCase {

  /**
   * A previous period below the minimum sample is not compared against.
   */
  public function testSmallPreviousSampleIsNotCompared(): void {
    $tiles = InsightTiles::build([
      'measurements' => [
        $this->measurement('closed_tickets', 10, 2),
        $this->measurement('runs', 15, 8),
        $this->measurement('rated_tickets', 6, 1),
        $this->measurement('job_rating', 4.2, 1.0),
        $this->measurement('run_tokens', 100, 50),
      ],
    ]);
    self::assertArrayNotHasKey('comparison', $tiles['runs_per_ticket']['#props']);
    self::assertArrayNotHasKey('comparison', $tiles['job_rating']['#props']);
    self::assertArrayHasKey('comparison', $tiles['closed_tickets']['#props']);
  }

  /**
   * A previous period with enough samples is compared against.
   */
  public function testLargePreviousSampleIsCompared(): void {
    $tiles = InsightTiles::build([
      'measurements' => [
        $this->measurement('closed_tickets', 10, 5),
        $this->measurement('runs', 15, 10),
        $this->measurement('rated_tickets', 6, 5),
        $this->measurement('job_rating', 4.2, 3.0),
      ],
    ]);
    self::assertSame('2.0', $tiles['runs_per_ticket']['#props']['comparison']['value']);
    self::assertSame('3.0', $tiles['job_rating']['#props']['comparison']['value']);
  }

  /**
   * Runs per ticket divides runs by closed tickets once, like the table.
   */
  public function testRunsPerTicketIsRoundedOnce(): void {
    $tiles = InsightTiles::build([
      'measurements' => [
        $this->measurement('closed_tickets', 17, 17),
        $this->measurement('runs', 62, 62),
        // The evaluator's 2-decimal ratio would round 3.647 up to "3.7".
        $this->measurement('runs_per_ticket', 3.65, 3.65),
      ],
    ]);
    self::assertSame('3.6', $tiles['runs_per_ticket']['#props']['value']);
    self::assertSame('3.6', $tiles['runs_per_ticket']['#props']['comparison']['value']);
  }

  /**
   * On My work the Closed tile counts the tickets assigned in the period.
   */
  public function testPersonalClosedDetailNamesAssigned(): void {
    $figure = [
      'measurements' => [
        $this->measurement('closed_tickets', 58, 50),
        $this->measurement('created_tickets', 61, 50),
      ],
    ];
    self::assertSame('61 assigned · backlog +3', InsightTiles::build($figure, 'assigned')['closed_tickets']['#props']['detail']);
    self::assertSame('61 created · backlog +3', InsightTiles::build($figure)['closed_tickets']['#props']['detail']);
  }

  /**
   * One evaluated measurement with its total and comparison total.
   *
   * @return array<string, mixed>
   *   The measurement payload.
   */
  private function measurement(string $id, int|float $total, int|float $previous): array {
    return ['id' => $id, 'values' => ['total' => $total], 'comparison' => ['values' => ['total' => $previous]]];
  }

}
