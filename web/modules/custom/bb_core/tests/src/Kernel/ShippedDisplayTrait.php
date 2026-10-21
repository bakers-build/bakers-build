<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel;

/**
 * Prepares a shipped display for a kernel test that enables only part of it.
 *
 * The shipped pages are composed in recipe config and also place sources of
 * other modules. A test of bb_core's part drops the sources whose plugin is
 * not installed, exactly as if the page had never placed them.
 */
trait ShippedDisplayTrait {

  /**
   * The display data without the sources the test does not enable.
   *
   * @param array<mixed> $data
   *   Display config data.
   *
   * @return array<mixed>
   *   The same data without unknown `source_id` nodes.
   */
  protected function withoutUnknownSources(array $data): array {
    $sources = $this->container->get('plugin.manager.ui_patterns_source');
    $walk = static function (array $node) use (&$walk, $sources): array {
      if (array_is_list($node) && $node !== [] && is_array($node[0]) && isset($node[0]['source_id'])) {
        $node = array_values(array_filter(
          $node,
          static fn (mixed $source): bool => !is_array($source) || !isset($source['source_id']) || $sources->hasDefinition((string) $source['source_id']),
        ));
      }
      foreach ($node as $key => $value) {
        if (is_array($value)) {
          $node[$key] = $walk($value);
        }
      }
      return $node;
    };
    return $walk($data);
  }

}
