<?php

declare(strict_types=1);

namespace Drupal\bb_core\Inspector;

use Drupal\Core\Entity\FieldableEntityInterface;

/**
 * Shared inspector list cells and field walk for entity property rails.
 *
 * Each entity keeps a thin subclass: the field map, empty-row policy, and
 * how a field becomes a cell. Ticket detail keeps dashes; Overview omits
 * empty rows.
 */
abstract class InspectorRows {

  /**
   * Drop rows that would only show the faint dash.
   *
   * Ticket detail keeps every row. Overview omits empty properties.
   */
  protected bool $omitEmpty = FALSE;

  /**
   * Walks field => label, checking field access, then fieldRow().
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity whose properties the rail shows.
   * @param array<string, string> $fields
   *   Field machine name => visible label, in display order.
   *
   * @return array<string, array<string, mixed>>
   *   List items keyed by field.
   */
  protected function buildRows(FieldableEntityInterface $entity, array $fields): array {
    $rows = [];
    foreach ($fields as $field => $label) {
      if (!$entity->hasField($field) || !$entity->get($field)->access('view')) {
        if (!$this->omitEmpty) {
          $rows[$field] = $this->row($label, $this->dash());
        }
        continue;
      }
      $row = $this->fieldRow($entity, $field, $label);
      if ($this->omitEmpty && $this->isEmpty($row)) {
        continue;
      }
      $rows[$field] = $row;
    }
    return $rows;
  }

  /**
   * One field as a list item. Default is the field's string value.
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity whose properties the rail shows.
   * @param string $field
   *   The field machine name.
   * @param string $label
   *   The row's visible label.
   *
   * @return array<string, mixed>
   *   The `list` item.
   */
  protected function fieldRow(FieldableEntityInterface $entity, string $field, string $label): array {
    return $this->row($label, $this->text((string) $entity->get($field)->value));
  }

  /**
   * The Properties heading over the given rows.
   *
   * @param array<string, array<string, mixed>> $rows
   *   The `list` items keyed by field, as build() returns them.
   * @param string $heading
   *   The zone heading.
   *
   * @return array<string, mixed>
   *   The `zone` render array, or empty when every row is absent.
   */
  public function propertiesBlock(array $rows, string $heading = 'Properties'): array {
    $items = array_values($rows);
    if ($items === []) {
      return [];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'columns' => 1],
      '#slots' => [
        'heading' => ['#plain_text' => $heading],
        'content' => $this->list($items),
      ],
    ];
  }

  /**
   * Wraps inspector row data in the shared list component.
   *
   * @param array<int|string, array<string, mixed>> $items
   *   The `list` items.
   * @param string $layout
   *   The `list` layout prop. Inspector rails use `plain`.
   *
   * @return array<string, mixed>
   *   The `list` render array.
   */
  public function list(array $items, string $layout = 'plain'): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:list',
      '#props' => ['layout' => $layout, 'items' => array_values($items)],
    ];
  }

  /**
   * One row: the faint label cell every row carries, plus its value cell.
   *
   * @param string $label
   *   The row's visible label.
   * @param array<string, mixed> $value
   *   The value cell.
   * @param array<string, array<string, mixed>> $extra
   *   Further cells, keyed — env-vars adds key and origin.
   *
   * @return array<string, mixed>
   *   The `list` item.
   */
  protected function row(string $label, array $value, array $extra = []): array {
    return [
      'cells' => [
        'label' => ['kind' => 'text', 'value' => $label, 'emphasis' => 'faint'],
      ] + $extra + ['value' => $value],
    ];
  }

  /**
   * One row of badge chips, or a dash when none.
   *
   * @param string $label
   *   The row's visible label.
   * @param array<int, array<string, mixed>> $chips
   *   Value cells after the label, in display order.
   *
   * @return array<string, mixed>
   *   The `list` item.
   */
  protected function chipsRow(string $label, array $chips): array {
    if ($chips === []) {
      return $this->row($label, $this->dash());
    }
    $cells = [
      'label' => ['kind' => 'text', 'value' => $label, 'emphasis' => 'faint'],
      'value' => array_shift($chips),
    ];
    foreach ($chips as $delta => $chip) {
      $cells['value_' . ($delta + 2)] = $chip;
    }
    return ['cells' => $cells];
  }

  /**
   * A badge cell.
   *
   * @param string $label
   *   The badge text.
   * @param string $tone
   *   The badge tone.
   * @param array<string, mixed> $extra
   *   Extra cell keys (`url`, `mono`, `suffix`, …).
   *
   * @return array<string, mixed>
   *   The value cell.
   */
  protected function badge(string $label, string $tone = 'neutral', array $extra = []): array {
    return ['kind' => 'badge', 'label' => $label, 'tone' => $tone] + $extra;
  }

  /**
   * Whether a row shows nothing but the faint dash.
   *
   * @param array<string, mixed> $row
   *   A `list` item.
   */
  protected function isEmpty(array $row): bool {
    return ($row['cells']['value'] ?? NULL) === $this->dash() && count($row['cells']) === 2;
  }

  /**
   * A monospaced value cell, degrading to a faint dash when empty.
   *
   * @return array<string, mixed>
   *   The value cell.
   */
  protected function mono(string $value): array {
    return $value === '' ? $this->dash() : ['kind' => 'mono', 'value' => $value];
  }

  /**
   * A plain text value cell, degrading to a faint dash when empty.
   *
   * @return array<string, mixed>
   *   The value cell.
   */
  protected function text(string $value): array {
    return $value === '' ? $this->dash() : ['kind' => 'text', 'value' => $value];
  }

  /**
   * The faint em-dash every empty row shows.
   *
   * @return array<string, mixed>
   *   The value cell.
   */
  protected function dash(): array {
    return ['kind' => 'text', 'value' => '—', 'emphasis' => 'faint'];
  }

  /**
   * The labels of a reference field the viewer may be told, comma-joined.
   *
   * `view label`, not `view`: no bakers.build role holds
   * `access user profiles`, so `view` would blank every other person; see
   * TicketReferenceCellFormatterBase. Every caller already varies per user.
   *
   * @param \Drupal\Core\Entity\FieldableEntityInterface $entity
   *   The entity that owns the field.
   * @param string $field
   *   The reference field machine name.
   */
  protected function labelsOf(FieldableEntityInterface $entity, string $field): string {
    $labels = [];
    foreach ($entity->get($field)->referencedEntities() as $target) {
      if ($target->access('view label')) {
        $labels[] = (string) $target->label();
      }
    }
    return implode(', ', $labels);
  }

}
