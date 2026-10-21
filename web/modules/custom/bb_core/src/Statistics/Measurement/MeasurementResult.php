<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Measurement;

/**
 * Immutable evaluated values for one measurement and ordered category set.
 */
final readonly class MeasurementResult {

  /**
   * Constructs an evaluated measurement result.
   *
   * @param string $id
   *   The measurement ID.
   * @param string $label
   *   The display label.
   * @param string $valueType
   *   The value type.
   * @param string $unit
   *   The display unit.
   * @param array<int, array{key: string, label: string, partial?: bool}> $categories
   *   The ordered categories.
   * @param array<string, int|float|null> $values
   *   The values keyed by category.
   */
  public function __construct(
    private string $id,
    private string $label,
    private string $valueType,
    private string $unit,
    private array $categories,
    private array $values,
  ) {}

  /**
   * Gets the measurement ID.
   */
  public function getId(): string {
    return $this->id;
  }

  /**
   * Gets the display label.
   */
  public function getLabel(): string {
    return $this->label;
  }

  /**
   * Gets the value type.
   */
  public function getValueType(): string {
    return $this->valueType;
  }

  /**
   * Gets the display unit.
   */
  public function getUnit(): string {
    return $this->unit;
  }

  /**
   * Gets the ordered categories.
   *
   * @return array<int, array{key: string, label: string, partial?: bool}>
   *   The categories.
   */
  public function getCategories(): array {
    return $this->categories;
  }

  /**
   * Gets values keyed by category.
   *
   * @return array<string, int|float|null>
   *   The values.
   */
  public function getValues(): array {
    return $this->values;
  }

  /**
   * Serializes the measurement result.
   *
   * @return array<string, mixed>
   *   The API payload.
   */
  public function toArray(): array {
    return [
      'id' => $this->id,
      'label' => $this->label,
      'value_type' => $this->valueType,
      'unit' => $this->unit,
      'values' => $this->values,
    ];
  }

}
