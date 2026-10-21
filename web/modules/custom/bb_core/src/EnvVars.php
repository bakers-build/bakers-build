<?php

declare(strict_types=1);

namespace Drupal\bb_core;

/**
 * Pure `.env`-style parse / merge / serialise helpers.
 *
 * Grammar: each line is `NAME=value`, where NAME matches
 * `^[A-Za-z_][A-Za-z0-9_]*$` and value is everything after the FIRST `=` of the
 * line, which is whitespace-trimmed first (so surrounding blanks are dropped;
 * no quoting/unescaping/interpolation — YAGNI). Blank lines and `#`-comment
 * lines are ignored. Anything else is malformed and skipped, its 1-indexed line
 * number recorded for a loud, content-free log by the caller.
 */
final class EnvVars {

  /**
   * The valid NAME pattern for an env var key.
   */
  private const NAME = '/^[A-Za-z_][A-Za-z0-9_]*$/';

  /**
   * Parse `.env`-style text into an ordered map (later duplicate wins).
   *
   * @param string $text
   *   The raw `.env`-style text.
   * @param array<int>|null $skipped
   *   By-ref: receives the 1-indexed line numbers of malformed lines.
   *
   * @param-out array<int> $skipped
   *
   * @return array<string, string>
   *   Ordered KEY => value map; malformed lines dropped.
   */
  public static function parse(string $text, ?array &$skipped = NULL): array {
    $skipped = [];
    $result = [];
    $lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
    foreach ($lines as $i => $raw) {
      $line = trim($raw);
      if ($line === '' || $line[0] === '#') {
        continue;
      }
      $eq = strpos($line, '=');
      if ($eq === FALSE) {
        $skipped[] = $i + 1;
        continue;
      }
      $key = substr($line, 0, $eq);
      if (preg_match(self::NAME, $key) !== 1) {
        $skipped[] = $i + 1;
        continue;
      }
      // Value is everything after the first '=', taken from the trimmed line.
      $result[$key] = substr($line, $eq + 1);
    }
    return $result;
  }

  /**
   * Merge maps left-to-right; on a duplicate key the rightmost value wins.
   *
   * Call root→self so the nearest (child) value overrides ancestors.
   *
   * @param array<string, string> ...$maps
   *   Maps to merge, ordered root→self.
   *
   * @return array<string, string>
   *   The merged map.
   */
  public static function merge(array ...$maps): array {
    return array_merge([], ...$maps);
  }

  /**
   * Serialise a map to canonical `KEY=value` lines (stable insertion order).
   *
   * @param array<string, string> $map
   *   The KEY => value map.
   *
   * @return string
   *   Newline-joined `KEY=value` lines (no trailing newline).
   */
  public static function toLines(array $map): string {
    $lines = [];
    foreach ($map as $key => $value) {
      $lines[] = $key . '=' . $value;
    }
    return implode("\n", $lines);
  }

}
