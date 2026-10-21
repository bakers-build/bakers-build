<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Figure;

/**
 * Validates selected figure filters and supplies their display metadata.
 */
final class FigureFilterResolver {

  /**
   * Resolves selected values against the configured figure filters.
   *
   * @param array<string, array<string, mixed>> $configured
   *   The figure filter configuration.
   * @param array<string, string> $selected
   *   The values selected by the request.
   *
   * @return array<string, array<string, mixed>>
   *   The resolved filter display metadata.
   */
  public function resolve(array $configured, array $selected): array {
    foreach (array_keys($selected) as $key) {
      if (!isset($configured[$key])) {
        throw new \InvalidArgumentException(sprintf('Unknown filter "%s".', $key));
      }
    }

    $resolved = [];
    foreach ($configured as $key => $filter) {
      $value = (string) ($selected[$key] ?? $filter['default'] ?? '');
      $allowed = array_map(static fn(array $option): string => (string) $option['value'], $filter['options'] ?? []);
      if (!in_array($value, $allowed, TRUE)) {
        throw new \InvalidArgumentException(sprintf('Unsupported value "%s" for filter "%s".', $value, $key));
      }
      $resolved[$key] = [
        'label' => (string) ($filter['label'] ?? $key),
        'value' => $value,
        'options' => $filter['options'] ?? [],
      ];
    }
    return $resolved;
  }

}
