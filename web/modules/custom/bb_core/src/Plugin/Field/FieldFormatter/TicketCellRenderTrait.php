<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

/**
 * Renders a `bb_theme:table` cell from a field formatter.
 *
 * The cell is rendered by the component's own `cell()` macro, imported by
 * component id (the one address Drupal and Storybook both resolve), so there
 * is one code path per cell face. The render array is returned unrendered so
 * cacheability metadata bubbles; the `rendered` cell prop is a string and
 * rejects render arrays, so Views renders it to markup first.
 */
trait TicketCellRenderTrait {

  /**
   * A cell, rendered by the table component's own macro.
   *
   * @param array<string, mixed> $cell
   *   The cell, in the shape `table.component.yml` declares for one entry of a
   *   row's `cells` map.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  protected function cellElement(array $cell): array {
    return [
      '#type' => 'inline_template',
      '#template' => "{% import 'bb_theme:table' as cells %}{{ cells.cell(cell) }}",
      '#context' => ['cell' => $cell],
    ];
  }

}
