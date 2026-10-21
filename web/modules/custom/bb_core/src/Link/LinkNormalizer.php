<?php

declare(strict_types=1);

namespace Drupal\bb_core\Link;

/**
 * Normalizes a ticket's link-field value at save time.
 *
 * Two passes over the raw field value: de-duplicate identical URIs (first
 * occurrence wins, order preserved) and derive each link's kind from its URI
 * into `options.bakers.kind`. This keeps a read-modify-write handoff that
 * re-attaches the same link clean, and keeps the kind server-derived so handoff
 * writes stay the plain `{uri, title}` shape. Idempotent on re-save.
 *
 * Pure and side-effect free.
 */
final class LinkNormalizer {

  /**
   * De-duplicates and classifies a link-field value list.
   *
   * @param array $values
   *   The raw field value: a list of `{uri, title, options?}` item arrays.
   *
   * @return array
   *   The deduped list, each item carrying a derived `options.bakers.kind`.
   */
  public static function normalize(array $values): array {
    $seen = [];
    $normalized = [];
    foreach ($values as $value) {
      $uri = (string) ($value['uri'] ?? '');
      if ($uri !== '' && isset($seen[$uri])) {
        continue;
      }
      $seen[$uri] = TRUE;
      $options = $value['options'] ?? [];
      $options['bakers']['kind'] = LinkKind::fromUri($uri);
      $value['options'] = $options;
      $normalized[] = $value;
    }
    return $normalized;
  }

}
