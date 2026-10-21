<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit\Time;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\bb_core\Time\BbDate;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Product date display: `normal` format id, ago versus hence.
 */
#[Group('bb_core')]
final class BbDateTest extends UnitTestCase {

  /**
   * Absolute display names the `normal` date format.
   */
  public function testNormalUsesTheNamedFormat(): void {
    $formatter = $this->createMock(DateFormatterInterface::class);
    $formatter->expects($this->once())
      ->method('format')
      ->with(1719757800, BbDate::NORMAL)
      ->willReturn('30 Jun 2026, 15:50');
    $date = $this->bakersDate($formatter, 1719760000);
    self::assertSame('30 Jun 2026, 15:50', $date->normal(1719757800));
  }

  /**
   * A past stamp is "@interval ago".
   */
  public function testAgoUsesSinceWhenTheStampIsPast(): void {
    $formatter = $this->createMock(DateFormatterInterface::class);
    $formatter->expects($this->once())
      ->method('formatTimeDiffSince')
      ->with(100, ['granularity' => 1])
      ->willReturn('2 hours');
    $date = $this->bakersDate($formatter, 200);
    self::assertSame('2 hours ago', $date->ago(100));
  }

  /**
   * A future stamp is "@interval hence".
   */
  public function testAgoUsesUntilWhenTheStampIsAhead(): void {
    $formatter = $this->createMock(DateFormatterInterface::class);
    $formatter->expects($this->once())
      ->method('formatTimeDiffUntil')
      ->with(300, ['granularity' => 1])
      ->willReturn('9 minutes');
    $date = $this->bakersDate($formatter, 200);
    self::assertSame('9 minutes hence', $date->ago(300));
  }

  /**
   * Formatter under test, with a stubbed translator.
   */
  private function bakersDate(DateFormatterInterface $formatter, int $now): BbDate {
    $time = $this->createMock(TimeInterface::class);
    $time->method('getRequestTime')->willReturn($now);
    $date = new BbDate($formatter, $time);
    $date->setStringTranslation($this->getStringTranslationStub());
    return $date;
  }

}
