<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_api_key\Unit;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Tests\UnitTestCase;
use Drupal\bb_api_key\ApiKeyManager;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;

/**
 * Pins the UTC expiry-date calendar contract with a controlled clock.
 *
 * "Now" is fixed to 2026-03-10T12:00:00Z throughout, so tomorrow/+90/+365
 * are deterministic real calendar dates (including the leap day they cross,
 * 2027 is not a leap year, so this run deliberately spans no Feb 29 — the
 * leap-day case is exercised directly by testLeapDayIsAccepted()).
 */
#[Group('bb_core')]
#[Group('bb_api_key')]
final class ApiKeyExpiryTest extends UnitTestCase {

  private const NOW = '2026-03-10T12:00:00+00:00';

  /**
   * Builds an ApiKeyManager with the clock fixed to the given instant.
   */
  private function manager(?string $now = NULL): ApiKeyManager {
    $time = $this->createMock(TimeInterface::class);
    $time->method('getCurrentTime')->willReturn((new \DateTimeImmutable($now ?? self::NOW))->getTimestamp());
    $entityTypeManager = $this->createMock(EntityTypeManagerInterface::class);
    return new ApiKeyManager($entityTypeManager, $time);
  }

  /**
   * Dates expiryTimestamp() must reject.
   *
   * @return array<string, array{0: string}>
   *   Rejected date strings, keyed by scenario label.
   */
  public static function rejectedDates(): array {
    return [
      'missing' => [''],
      'malformed' => ['not-a-date'],
      'impossible calendar date' => ['2026-02-30'],
      'noncanonical' => ['2026-3-10'],
      'today' => ['2026-03-10'],
      'yesterday' => ['2026-03-09'],
      'one day past the max' => ['2027-03-11'],
    ];
  }

  /**
   * Each listed date is rejected.
   */
  #[DataProvider('rejectedDates')]
  public function testRejectedDates(string $date): void {
    $this->expectException(\InvalidArgumentException::class);
    $this->manager()->expiryTimestamp($date);
  }

  /**
   * Tomorrow is the earliest accepted expiry.
   */
  public function testTomorrowIsAccepted(): void {
    $timestamp = $this->manager()->expiryTimestamp('2026-03-11');
    $this->assertSame('2026-03-12T00:00:00+00:00', gmdate('Y-m-d\TH:i:sP', $timestamp));
  }

  /**
   * The default 90-days-out date is accepted.
   */
  public function testDefaultNinetyDaysIsAccepted(): void {
    $timestamp = $this->manager()->expiryTimestamp('2026-06-08');
    $this->assertSame('2026-06-09T00:00:00+00:00', gmdate('Y-m-d\TH:i:sP', $timestamp));
  }

  /**
   * The maximum, 365 days out, is accepted.
   */
  public function testMaxThreeHundredSixtyFiveDaysIsAccepted(): void {
    $timestamp = $this->manager()->expiryTimestamp('2027-03-10');
    $this->assertSame('2027-03-11T00:00:00+00:00', gmdate('Y-m-d\TH:i:sP', $timestamp));
  }

  /**
   * A real leap day is accepted as a calendar date.
   */
  public function testLeapDayIsAccepted(): void {
    $timestamp = $this->manager('2027-12-01T00:00:00+00:00')->expiryTimestamp('2028-02-29');
    $this->assertSame('2028-03-01T00:00:00+00:00', gmdate('Y-m-d\TH:i:sP', $timestamp));
  }

  /**
   * The default expiry date offered is today plus 90 days.
   */
  public function testDefaultExpiryDateIsNinetyDaysOut(): void {
    $this->assertSame('2026-06-08', $this->manager()->defaultExpiryDate());
  }

}
