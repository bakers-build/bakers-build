<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Render;

/**
 * Number formats shared by the Insights tiles, bars and tables.
 */
final class FigureFormat {

  /**
   * A value based on fewer closed or rated tickets is withheld.
   */
  public const MIN_SAMPLE = 5;

  /**
   * An abbreviated count: one decimal under 100 of its unit, none above.
   *
   * 28412553104 reads "28.4 B", 132768939 reads "133 M", 999 reads "999".
   */
  public static function abbreviate(int|float $value): string {
    $abs = abs((float) $value);
    foreach ([[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as [$size, $unit]) {
      if ($abs >= $size) {
        $scaled = $value / $size;
        return number_format($scaled, abs($scaled) >= 100 ? 0 : 1) . ' ' . $unit;
      }
    }
    return number_format((float) $value, 0);
  }

  /**
   * The exact token count behind an abbreviation, with its calculation.
   */
  public static function exactTokens(int|float $value, string $calculation = 'Sum of run tokens by run start, UTC', string $unit = 'tokens'): string {
    return number_format((float) $value, 0) . ' ' . $unit . ' — ' . $calculation;
  }

  /**
   * A value with one decimal.
   */
  public static function decimal(int|float $value): string {
    return number_format((float) $value, 1);
  }

  /**
   * The change against the previous value in whole percent.
   *
   * @return array{delta: string, direction: string}
   *   The formatted change and its direction.
   */
  public static function percentChange(int|float|null $value, int|float|null $previous): array {
    if ($value === NULL || $previous === NULL || (float) $previous === 0.0) {
      return ['delta' => '—', 'direction' => 'flat'];
    }
    $percent = (int) round(((float) $value - (float) $previous) / abs((float) $previous) * 100);
    return match (TRUE) {
      $percent > 0 => ['delta' => '+' . $percent . ' %', 'direction' => 'up'],
      $percent < 0 => ['delta' => $percent . ' %', 'direction' => 'down'],
      default => ['delta' => '0 %', 'direction' => 'flat'],
    };
  }

  /**
   * The absolute change of a ratio or a mean, with one decimal.
   *
   * @return array{delta: string, direction: string}
   *   The formatted change and its direction.
   */
  public static function absoluteChange(float $value, float $previous): array {
    $difference = round(round($value, 1) - round($previous, 1), 1);
    return match (TRUE) {
      $difference > 0 => ['delta' => '+' . self::decimal($difference), 'direction' => 'up'],
      $difference < 0 => ['delta' => self::decimal($difference), 'direction' => 'down'],
      default => ['delta' => '0.0', 'direction' => 'flat'],
    };
  }

}
