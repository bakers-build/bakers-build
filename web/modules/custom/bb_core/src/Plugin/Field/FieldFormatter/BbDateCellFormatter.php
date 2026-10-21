<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldFormatter;

use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Field\Attribute\FieldFormatter;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Field\FormatterBase;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * A timestamp column: an ISO date, read DOWN the column.
 *
 * A `mono` custom `Y-m-d` format, not a localised site date format, so rows
 * compare at a glance and sort as the digits read.
 */
#[FieldFormatter(
  id: 'bb_date_cell',
  label: new TranslatableMarkup('Table cell: ISO date'),
  description: new TranslatableMarkup('The timestamp as a fixed-width Y-m-d date, in a bb_theme:table cell.'),
  field_types: ['created', 'changed', 'timestamp'],
)]
final class BbDateCellFormatter extends FormatterBase {

  use TicketCellRenderTrait;

  /**
   * The date formatter, which owns the site timezone.
   */
  private DateFormatterInterface $dateFormatter;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = new static(
      $plugin_id,
      $plugin_definition,
      $configuration['field_definition'],
      $configuration['settings'],
      $configuration['label'],
      $configuration['view_mode'],
      $configuration['third_party_settings'],
    );
    $instance->dateFormatter = $container->get('date.formatter');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function viewElements(FieldItemListInterface $items, $langcode): array {
    $elements = [];
    foreach ($items as $delta => $item) {
      $timestamp = (int) $item->get('value')->getValue();
      if ($timestamp <= 0) {
        // Zero is not a date, and 1970-01-01 in a `Member since` column is a
        // wrong statement rather than a missing one. The template's own em-dash
        // rule renders the absence.
        continue;
      }
      $elements[$delta] = $this->cellElement([
        'kind' => 'mono',
        'value' => $this->dateFormatter->format($timestamp, 'custom', 'Y-m-d'),
      ]);
    }
    return $elements;
  }

}
