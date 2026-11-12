<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Unit\Time;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Datetime\FormattedDateDiff;
use Drupal\bb_core\Time\BbDate;
use Drupal\Tests\UnitTestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Product time and duration display.
 */
#[Group('bb_core')]
final class BbDateTest extends UnitTestCase {

  /**
   * Request time: Mon, 22 Jun 2026, 12:00 UTC.
   */
  private const NOW = 1782129600;

  /**
   * Under seven days a stamp reads relative, older ones absolute.
   */
  #[DataProvider('labels')]
  public function testLabel(string $stamp, string $expected): void {
    self::assertSame($expected, $this->bakersDate()->label((int) strtotime($stamp)));
  }

  /**
   * Stamps around the seven-day and year boundaries.
   *
   * @return array<string, array{string, string}>
   *   Stamp and expected label.
   */
  public static function labels(): array {
    return [
      'two hours ago' => ['2026-06-22T10:00:00Z', '2 hours ago'],
      'three hours ahead' => ['2026-06-22T15:00:00Z', 'in 3 hours'],
      'just under seven days' => ['2026-06-15T13:00:01Z', '6 days ago'],
      'seven days' => ['2026-06-15T12:00:00Z', '15 Jun, 12:00'],
      'same year' => ['2026-01-06T13:30:00Z', '6 Jan, 13:30'],
      'another year' => ['2025-06-15T13:30:00Z', '15 Jun 2025'],
    ];
  }

  /**
   * A date-only value is never relative.
   */
  public function testDateOnly(): void {
    $date = $this->bakersDate();
    self::assertSame('22 Jun', $date->date((int) strtotime('2026-06-22T10:00:00Z')));
    self::assertSame('6 Jan 2025', $date->date((int) strtotime('2025-01-06T10:00:00Z')));
  }

  /**
   * The time element carries ISO `datetime` and the full stamp as `title`.
   */
  public function testTimeElement(): void {
    $element = $this->bakersDate()->time((int) strtotime('2026-06-08T13:30:00Z'));
    self::assertSame('bb_theme:time', $element['#component']);
    self::assertSame([
      'datetime' => '2026-06-08T13:30:00+00:00',
      'title' => 'Mon, 8 Jun 2026, 13:30 UTC',
      'label' => '8 Jun, 13:30',
    ], $element['#props']);
  }

  /**
   * A relative label expires with its interval.
   */
  public function testRelativeTimeCarriesMaxAge(): void {
    $element = $this->bakersDate()->time((int) strtotime('2026-06-22T10:00:00Z'));
    self::assertSame('2 hours ago', $element['#props']['label']);
    self::assertSame(3600, $element['#cache']['max-age']);
  }

  /**
   * An age stays relative past the seven-day window and expires with it.
   */
  public function testAgeStaysRelative(): void {
    $element = $this->bakersDate()->age((int) strtotime('2026-06-01T12:00:00Z'));
    self::assertSame('bb_theme:time', $element['#component']);
    self::assertSame([
      'datetime' => '2026-06-01T12:00:00+00:00',
      'title' => 'Mon, 1 Jun 2026, 12:00 UTC',
      'label' => '21 days ago',
    ], $element['#props']);
    self::assertSame(86400, $element['#cache']['max-age']);
  }

  /**
   * Durations read "41s", "36 min" or "1h 10m".
   */
  #[DataProvider('durations')]
  public function testDuration(int $seconds, string $expected): void {
    self::assertSame($expected, $this->bakersDate()->duration($seconds));
  }

  /**
   * Duration boundaries.
   *
   * @return array<string, array{int, string}>
   *   Seconds and expected label.
   */
  public static function durations(): array {
    return [
      'zero' => [0, '0s'],
      'seconds' => [41, '41s'],
      'last second' => [59, '59s'],
      'one minute' => [60, '1 min'],
      'minutes' => [2160, '36 min'],
      'last minute' => [3599, '59 min'],
      'one hour' => [3600, '1h 0m'],
      'hours' => [4210, '1h 10m'],
      'past a day' => [94000, '26h 6m'],
    ];
  }

  /**
   * Formatter under test: a UTC date formatter and a stubbed translator.
   */
  private function bakersDate(): BbDate {
    $formatter = $this->createMock(DateFormatterInterface::class);
    $formatter->method('format')->willReturnCallback(
      static fn (int $timestamp, string $type, string $pattern): string => (new \DateTimeImmutable('@' . $timestamp))->setTimezone(new \DateTimeZone('UTC'))->format($pattern),
    );
    $diff = static function (int $from, int $to): FormattedDateDiff {
      $hours = intdiv(abs($to - $from), 3600);
      return $hours >= 24
        ? new FormattedDateDiff(intdiv($hours, 24) . ' days', 86400)
        : new FormattedDateDiff($hours . ' hours', 3600);
    };
    $formatter->method('formatTimeDiffSince')->willReturnCallback(
      static fn (int $timestamp): FormattedDateDiff => $diff($timestamp, self::NOW),
    );
    $formatter->method('formatTimeDiffUntil')->willReturnCallback(
      static fn (int $timestamp): FormattedDateDiff => $diff(self::NOW, $timestamp),
    );
    $time = $this->createMock(TimeInterface::class);
    $time->method('getRequestTime')->willReturn(self::NOW);
    $date = new BbDate($formatter, $time);
    $date->setStringTranslation($this->getStringTranslationStub());
    return $date;
  }

}
