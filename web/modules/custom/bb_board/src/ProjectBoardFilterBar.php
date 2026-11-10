<?php

declare(strict_types=1);

namespace Drupal\bb_board;

use Drupal\Core\StringTranslation\StringTranslationTrait;

/**
 * The Board filter bar's parts the exposed form does not build.
 *
 * The Assignee avatars, the Details control, Clear filters and the active
 * filter chips with "N of M open tickets", as render arrays.
 *
 * @see \Drupal\bb_board\Plugin\views\area\BbBoardSummary
 */
final class ProjectBoardFilterBar {

  use StringTranslationTrait;

  public function __construct(
    private readonly BoardAddress $address,
  ) {}

  /**
   * The Assignee label, an avatar toggle per person with a count, Unassigned.
   *
   * @param list<array<string, mixed>> $rows
   *   The employee rows.
   *
   * @return list<array<string, mixed>>
   *   Render arrays.
   */
  public function assignees(array $rows): array {
    if ($rows === []) {
      return [];
    }
    $items = [$this->meta((string) $this->t('Assignee'))];
    foreach ($rows as $row) {
      $person = isset($row['initials']);
      $props = $row['value'] === NULL ? ['disabled' => TRUE] : ['href' => $this->address->toggle('assignee', $row['value'])];
      $item = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#variant' => $person ? 'ghost' : 'neutral',
        '#props' => $props + [
          'label' => $person ? (string) $row['count'] : $row['label'] . ' · ' . $row['count'],
          'pressed' => $row['active'],
        ],
      ];
      if ($person) {
        // The avatar shows initials only: the name is the accessible name.
        $item['#props']['aria_label'] = (string) $this->formatPlural($row['count'], '@name, 1 ticket', '@name, @count tickets', ['@name' => $row['label']]);
        $item['#attributes'] = ['title' => $row['label']];
        $item['#slots']['icon'] = [
          '#type' => 'component',
          '#component' => 'bb_theme:person',
          '#props' => [
            'variant' => 'compact',
            'initials' => $row['initials'],
            'color' => $row['color'],
            'display_name' => '',
          ],
        ];
      }
      $items[] = $item;
    }
    return $items;
  }

  /**
   * A State or Priority picker with each option's count.
   *
   * @param array<string, mixed> $picker
   *   The picker element, empty when the form has none.
   * @param list<array<string, mixed>> $rows
   *   The facet's rows.
   *
   * @return array<string, mixed>
   *   The picker, its options counted.
   */
  public function withCounts(array $picker, array $rows): array {
    $counts = array_column(array_filter($rows, static fn (array $row): bool => $row['value'] !== NULL), 'count', 'value');
    foreach ($picker['#slots']['options']['#props']['options'] ?? [] as $delta => $option) {
      $picker['#slots']['options']['#props']['options'][$delta]['count'] = (string) ($counts[$option['value']] ?? 0);
    }
    return $picker;
  }

  /**
   * The Details label and its Phases | States control.
   *
   * @param bool $states
   *   Whether Details shows States; Phases otherwise.
   *
   * @return list<array<string, mixed>>
   *   Render arrays.
   */
  public function details(bool $states): array {
    return [
      $this->meta((string) $this->t('Details')),
      [
        '#type' => 'component',
        '#component' => 'bb_theme:segmented_control',
        '#props' => [
          'label' => (string) $this->t('Details'),
          'items' => [
            [
              'label' => (string) $this->t('Phases'),
              'url' => $this->address->withDetails(FALSE),
              'active' => !$states,
            ],
            [
              'label' => (string) $this->t('States'),
              'url' => $this->address->withDetails(TRUE),
              'active' => $states,
            ],
          ],
        ],
      ],
    ];
  }

  /**
   * The active filter chips with their counts, then "N of M open tickets".
   *
   * @param list<array<string, mixed>> $chips
   *   The active filters as `active-filters` facets.
   * @param int $total
   *   The tickets every filter matches.
   * @param int|null $open
   *   The open tickets before the clearable filters, NULL when unknown.
   *
   * @return array<string, mixed>
   *   An `active-filters` render array.
   */
  public function activeFilters(array $chips, int $total, ?int $open): array {
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:active-filters',
      '#props' => [
        'label' => (string) $this->t('Active filters'),
        'empty_label' => (string) $this->t('No filters'),
        'facets' => $chips,
      ],
    ];
    if ($open !== NULL) {
      $build['#slots']['meta'] = $this->meta((string) $this->t('@count of @total open tickets', [
        '@count' => $total,
        '@total' => $open,
      ]));
    }
    return $build;
  }

  /**
   * The Clear filters link, empty when nothing clearable is chosen.
   *
   * @return array<string, mixed>
   *   A `button` render array.
   */
  public function clear(): array {
    $clear = $this->address->clear();
    return $clear === NULL ? [] : [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#variant' => 'ghost',
      '#props' => ['label' => (string) $this->t('Clear filters'), 'href' => $clear],
    ];
  }

  /**
   * A short faint label in the filter bar.
   *
   * @return array<string, mixed>
   *   A `text` render array.
   */
  private function meta(string $text): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:text',
      '#props' => ['text' => $text, 'as' => 'span', 'size' => 'meta', 'tone' => 'light'],
    ];
  }

}
