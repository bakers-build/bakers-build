<?php

declare(strict_types=1);

namespace Drupal\bb_core;

use Drupal\Core\Config\Entity\ConfigEntityInterface;

/**
 * Defines a titled, ordered group of figures.
 */
interface BbFigureGroupInterface extends ConfigEntityInterface {

  /**
   * {@inheritdoc}
   */
  public function getWeight(): int;

  /**
   * Gets the ordered figure IDs.
   *
   * @return array<string>
   *   The figure IDs.
   */
  public function getFigures(): array;

}
