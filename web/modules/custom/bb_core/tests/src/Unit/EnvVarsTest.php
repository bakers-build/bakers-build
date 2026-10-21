<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit;

use Drupal\bb_core\EnvVars;
use Drupal\Tests\UnitTestCase;

/**
 * @coversDefaultClass \Drupal\bb_core\EnvVars
 *
 * @group bb_core
 */
final class EnvVarsTest extends UnitTestCase {

  /**
   * @covers ::parse
   */
  public function testParseSkipsCommentsAndBlanksAndSplitsOnFirstEquals(): void {
    self::assertSame(
      ['A' => '1', 'B' => 'x=y'],
      EnvVars::parse("A=1\n# a comment\n\nB=x=y"),
    );
  }

  /**
   * @covers ::parse
   */
  public function testParseLaterWins(): void {
    self::assertSame(['A' => '2'], EnvVars::parse("A=1\nA=2"));
  }

  /**
   * @covers ::parse
   */
  public function testParseRecordsMalformedLineNumbersAndDropsThem(): void {
    $skipped = NULL;
    $result = EnvVars::parse("GOOD=1\nthis is not valid\n# c\n=novalue", $skipped);
    self::assertSame(['GOOD' => '1'], $result);
    // Line 2 (malformed text) and line 4 (empty key) are recorded 1-indexed.
    self::assertSame([2, 4], $skipped);
  }

  /**
   * @covers ::merge
   */
  public function testMergeRightWins(): void {
    self::assertSame(
      ['A' => '2', 'B' => '1'],
      EnvVars::merge(['A' => '1', 'B' => '1'], ['A' => '2']),
    );
  }

  /**
   * @covers ::toLines
   */
  public function testToLinesCanonicalInsertionOrder(): void {
    self::assertSame(
      "A=1\nB=2",
      EnvVars::toLines(['A' => '1', 'B' => '2']),
    );
  }

}
