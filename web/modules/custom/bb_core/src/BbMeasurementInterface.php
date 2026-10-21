<?php

declare(strict_types=1);

namespace Drupal\bb_core;

use Drupal\Core\Config\Entity\ConfigEntityInterface;

/**
 * Defines one reusable statistics calculation.
 */
interface BbMeasurementInterface extends ConfigEntityInterface {

  /**
   * {@inheritdoc}
   */
  public function getValueType(): string;

  /**
   * {@inheritdoc}
   */
  public function getUnit(): string;

  /**
   * Gets the source configuration.
   *
   * @return array<string, mixed>
   *   The source configuration.
   */
  public function getSource(): array;

  /**
   * Gets the operation configuration.
   *
   * @return array<string, mixed>
   *   The operation configuration.
   */
  public function getOperation(): array;

  /**
   * Gets the query predicates.
   *
   * @return array<int, array<string, mixed>>
   *   The predicate configuration.
   */
  public function getPredicates(): array;

  /**
   * Gets the context bindings.
   *
   * @return array<string, array<string, mixed>>
   *   The bindings keyed by context name.
   */
  public function getBindings(): array;

  /**
   * Gets the dimension configuration.
   *
   * @return array<string, array<string, string>>
   *   The dimensions keyed by dimension name.
   */
  public function getDimensions(): array;

}
