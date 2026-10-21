<?php

declare(strict_types=1);

namespace Drupal\bb_core;

use Drupal\Core\Condition\ConditionInterface;
use Drupal\Core\Condition\ConditionPluginCollection;
use Drupal\Core\Config\Entity\ConfigEntityInterface;
use Drupal\Core\Entity\EntityWithPluginCollectionInterface;

/**
 * Defines one atomic server-composed statistics figure.
 */
interface BbFigureInterface extends ConfigEntityInterface, EntityWithPluginCollectionInterface {

  /**
   * {@inheritdoc}
   */
  public function getDescription(): string;

  /**
   * {@inheritdoc}
   */
  public function getWeight(): int;

  /**
   * {@inheritdoc}
   */
  public function getWidget(): string;

  /**
   * Gets the ordered measurement IDs.
   *
   * @return array<string>
   *   The measurement IDs.
   */
  public function getMeasurements(): array;

  /**
   * Gets the category configuration.
   *
   * @return array<string, mixed>
   *   The category configuration.
   */
  public function getCategories(): array;

  /**
   * Gets the series source configuration.
   *
   * @return array<string, mixed>
   *   `[]` when the figure carries no series axis, otherwise
   *   `['dimension' => string, 'limit' => int]`.
   */
  public function getSeries(): array;

  /**
   * Gets the filter configuration.
   *
   * @return array<string, mixed>
   *   The filter configuration.
   */
  public function getFilters(): array;

  /**
   * Gets the required route context keys.
   *
   * @return array<string>
   *   The context keys.
   */
  public function getContextShape(): array;

  /**
   * {@inheritdoc}
   */
  public function getConditions(): ConditionPluginCollection;

  /**
   * {@inheritdoc}
   */
  public function getCondition(string $instanceId): ConditionInterface;

  /**
   * Gets the condition plugin configuration.
   *
   * @return array<string, array<string, mixed>>
   *   The condition configuration keyed by plugin instance ID.
   */
  public function getConditionConfiguration(): array;

}
