<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Field\FieldWidget;

use Drupal\Core\Field\FieldItemListInterface;

/**
 * Presentation settings and render arrays supplied by a picker widget.
 */
interface PickerWidgetInterface {

  public const REGION_CONTEXT = 'context';
  public const REGION_LEAD = 'lead';
  public const REGION_LINES = 'lines';
  public const REGION_PILLS = 'pills';

  /**
   * Returns the presenter region configured on the widget.
   */
  public function pickerRegion(): string;

  /**
   * Builds the picker control for the current field items.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  public function pickerElement(FieldItemListInterface $items): array;

  /**
   * Returns the field's display label.
   */
  public function pickerLabel(): string;

  /**
   * Builds an optional note for the field.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  public function pickerNote(FieldItemListInterface $items): array;

}
