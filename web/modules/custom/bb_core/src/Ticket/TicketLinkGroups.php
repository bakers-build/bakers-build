<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\bb_core\Link\LinkKind;

/**
 * Groups a ticket's links into the band's four link groups.
 *
 * Reads the `options.bakers.kind` that `LinkNormalizer` stores on save; its
 * values are exactly `link-group`'s `kind` enum. Groups: Code, Test results,
 * Try it yourself, More; an empty group renders nothing. A `report` row is a
 * titled link only — it fetches no artifact. Pure: no loads, no services.
 */
final class TicketLinkGroups {

  /**
   * The four groups, in the order the band lays them out, and their kinds.
   *
   * ONE CONSTANT AND ONE PLACE. A kind that appears in no group would vanish
   * from the band silently, so a new kind's arrival is a change here and
   * nowhere else.
   */
  private const GROUPS = [
    'Code' => [LinkKind::MR, LinkKind::BRANCH],
    'Test results' => [LinkKind::CI, LinkKind::REPORT],
    'Try it yourself' => [LinkKind::DDEV, LinkKind::DESIGN],
    'More' => [LinkKind::DOC, LinkKind::CHAT],
  ];

  /**
   * The extra props a `report` row renders when — and only when — it has them.
   */
  private const REPORT_PROPS = ['passed', 'failed', 'duration'];

  /**
   * Builds the band's `links` slot from a ticket's raw link-field value.
   *
   * @param array<int, array<string, mixed>> $values
   *   The raw `links` field value: a list of `{uri, title, options?}` items, as
   *   `$ticket->get('links')->getValue()` returns it.
   *
   * @return array<int, array<string, mixed>>
   *   Zero to four `bb_theme:link-group` render arrays, in the fixed order.
   *   A group with no rows is absent entirely.
   */
  public static function build(array $values): array {
    $rows = array_map(static fn(array $value): array => self::row($value), $values);

    $groups = [];
    foreach (self::GROUPS as $label => $kinds) {
      // Filtered in FIELD order rather than collected kind by kind: within a
      // group the order a human curated on the ticket is the order they meant,
      // and bucketing by kind would silently sort every merge request above
      // every branch.
      $links = array_values(array_filter(
        $rows,
        static fn(array $row): bool => in_array($row['kind'], $kinds, TRUE),
      ));
      if ($links === []) {
        continue;
      }
      $groups[] = [
        '#type' => 'component',
        '#component' => 'bb_theme:link-group',
        '#props' => ['label' => $label, 'links' => $links],
      ];
    }
    return $groups;
  }

  /**
   * Maps one raw link item to one `link-group` row.
   *
   * @param array<string, mixed> $value
   *   A raw `{uri, title, options?}` field item.
   *
   * @return array<string, mixed>
   *   The row, always carrying `url`, `title` and `kind`.
   */
  private static function row(array $value): array {
    $uri = (string) ($value['uri'] ?? '');
    $bakers = (array) ($value['options']['bakers'] ?? []);
    $kind = self::kind($uri, $bakers);

    $row = [
      'url' => $uri,
      'title' => (string) ($value['title'] ?? '') ?: $uri,
      'kind' => $kind,
    ];
    // Counts belong to the report row and to no other, because no other row
    // renders them — carrying them elsewhere would put data in the render array
    // that nothing can show.
    if ($kind === LinkKind::REPORT) {
      foreach (self::REPORT_PROPS as $prop) {
        if (isset($bakers[$prop])) {
          $row[$prop] = $bakers[$prop];
        }
      }
    }
    return $row;
  }

  /**
   * The row's kind: the stored one when it is valid, else derived from the URI.
   *
   * The fallback is not defensive decoration. `options.bakers.kind` has only
   * been written since normalisation existed, and an unknown value — from an
   * import, or from a hand-edited field — would otherwise put the link in no
   * group at all, which is indistinguishable from losing it.
   *
   * @param string $uri
   *   The link URI.
   * @param array<string, mixed> $bakers
   *   The item's `options.bakers` map.
   */
  private static function kind(string $uri, array $bakers): string {
    $stored = (string) ($bakers['kind'] ?? '');
    return in_array($stored, LinkKind::KINDS, TRUE) ? $stored : LinkKind::fromUri($uri);
  }

}
