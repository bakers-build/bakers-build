<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Condition\ConditionInterface;
use Drupal\Core\Condition\ConditionPluginCollection;
use Drupal\Core\Config\Entity\ConfigEntityBase;
use Drupal\Core\Entity\Attribute\ConfigEntityType;
use Drupal\Core\Entity\EntityDeleteForm;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Form\BbFigureForm;
use Drupal\bb_core\BbFigureInterface;
use Drupal\bb_core\BbMeasurementInterface;
use Drupal\bb_core\ListBuilder\BbFigureListBuilder;
use Drupal\bb_core\Statistics\Period\PeriodResolver;

/**
 * Stores one atomic server-composed statistics figure.
 */
#[ConfigEntityType(
  id: 'bb_figure',
  label: new TranslatableMarkup('bakers.build figure'),
  label_collection: new TranslatableMarkup('bakers.build figures'),
  label_singular: new TranslatableMarkup('bakers.build figure'),
  label_plural: new TranslatableMarkup('bakers.build figures'),
  config_prefix: 'bb_figure',
  entity_keys: ['id' => 'id', 'label' => 'label', 'weight' => 'weight'],
  handlers: [
    'list_builder' => BbFigureListBuilder::class,
    'form' => [
      'add' => BbFigureForm::class,
      'edit' => BbFigureForm::class,
      'delete' => EntityDeleteForm::class,
    ],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
  ],
  links: [
    'add-form' => '/admin/bakers/config/statistics/figures/add',
    'edit-form' => '/admin/bakers/config/statistics/figures/{bb_figure}/edit',
    'delete-form' => '/admin/bakers/config/statistics/figures/{bb_figure}/delete',
    'collection' => '/admin/bakers/config/statistics/figures',
  ],
  admin_permission: 'administer bakers',
  config_export: [
    'id',
    'label',
    'description',
    'weight',
    'widget',
    'measurements',
    'categories',
    'series',
    'ratio',
    'filters',
    'context_shape',
    'conditions',
  ],
)]
final class BbFigure extends ConfigEntityBase implements BbFigureInterface {

  /**
   * The configuration identifier.
   */
  protected string $id = '';
  /**
   * The display label.
   */
  protected string $label = '';
  /**
   * The display description.
   */
  protected string $description = '';
  /**
   * The display weight.
   */
  protected int $weight = 0;
  /**
   * The widget identifier.
   */
  protected string $widget = 'matrix';
  /**
   * The ordered measurement identifiers.
   */
  protected array $measurements = [];
  /**
   * The category configuration.
   */
  protected array $categories = [];
  /**
   * The series source configuration.
   */
  protected array $series = [];
  /**
   * The ratio configuration.
   */
  protected array $ratio = [];
  /**
   * The filter configuration.
   */
  protected array $filters = [];
  /**
   * The required context keys.
   */
  protected array $context_shape = [];
  /**
   * The condition plugin configuration.
   */
  protected array $conditions = [];
  /**
   * The instantiated condition plugins.
   */
  protected ?ConditionPluginCollection $conditionCollection = NULL;

  /**
   * {@inheritdoc}
   */
  public function getDescription(): string {
    return $this->description;
  }

  /**
   * {@inheritdoc}
   */
  public function getWeight(): int {
    return $this->weight;
  }

  /**
   * {@inheritdoc}
   */
  public function getWidget(): string {
    return $this->widget;
  }

  /**
   * {@inheritdoc}
   */
  public function getMeasurements(): array {
    return $this->measurements;
  }

  /**
   * {@inheritdoc}
   */
  public function getCategories(): array {
    return $this->categories;
  }

  /**
   * {@inheritdoc}
   */
  public function getSeries(): array {
    return $this->series;
  }

  /**
   * {@inheritdoc}
   */
  public function getRatio(): array {
    return $this->ratio;
  }

  /**
   * {@inheritdoc}
   */
  public function getFilters(): array {
    return $this->filters;
  }

  /**
   * {@inheritdoc}
   */
  public function getContextShape(): array {
    return $this->context_shape;
  }

  /**
   * {@inheritdoc}
   */
  public function getConditions(): ConditionPluginCollection {
    if ($this->conditionCollection === NULL) {
      $this->conditionCollection = new ConditionPluginCollection(\Drupal::service('plugin.manager.condition'), $this->conditions);
    }
    return $this->conditionCollection;
  }

  /**
   * {@inheritdoc}
   */
  public function getCondition(string $instanceId): ConditionInterface {
    return $this->getConditions()->get($instanceId);
  }

  /**
   * {@inheritdoc}
   */
  public function getConditionConfiguration(): array {
    return $this->getConditions()->getConfiguration();
  }

  /**
   * {@inheritdoc}
   */
  public function getPluginCollections(): array {
    return ['conditions' => $this->getConditions()];
  }

  /**
   * {@inheritdoc}
   */
  public function calculateDependencies() {
    parent::calculateDependencies();
    foreach ($this->measurements as $measurementId) {
      $this->addDependency('config', 'bb_core.bb_measurement.' . $measurementId);
    }
    return $this;
  }

  /**
   * {@inheritdoc}
   *
   * PHPMD combines class metrics when its repository-wide command receives
   * multiple source roots; this method only delegates to focused validators.
   *
   * @SuppressWarnings("PHPMD.NPathComplexity")
   * @SuppressWarnings("PHPMD.CyclomaticComplexity")
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    $this->validateFigureShape();
    $measurements = $this->loadReferencedMeasurements();
    $this->validateCategories($measurements);
    $this->validateFilters();
  }

  /**
   * Validates the figure's top-level structural choices.
   */
  private function validateFigureShape(): void {
    if ($this->measurements === []) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" must reference at least one measurement.', $this->id()));
    }
    if (count($this->measurements) !== count(array_unique($this->measurements))) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" contains duplicate measurements.', $this->id()));
    }
    $this->validateWidget();
    if ($this->ratio !== [] && array_diff([$this->ratio['numerator'] ?? '', $this->ratio['denominator'] ?? ''], $this->measurements) !== []) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" ratio must divide two of its own measurements.', $this->id()));
    }
    if (count($this->context_shape) !== count(array_unique($this->context_shape))) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" contains duplicate context keys.', $this->id()));
    }
  }

  /**
   * Validates the widget and what it needs from measurements and categories.
   */
  private function validateWidget(): void {
    if (!in_array($this->widget, ['matrix', 'line', 'grouped_horizontal_bars', 'flow', 'tiles', 'table', 'bars'], TRUE)) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" has unsupported widget "%s".', $this->id(), $this->widget));
    }
    if ($this->widget === 'flow' && count($this->measurements) !== 3) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" is a flow and needs exactly three measurements: new, done, open.', $this->id()));
    }
    $required = ['tiles' => 'total', 'table' => 'dimension', 'bars' => 'dimension'][$this->widget] ?? NULL;
    if ($required !== NULL && ($this->categories['type'] ?? '') !== $required) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" is %s and needs %s categories.', $this->id(), $this->widget, $required));
    }
  }

  /**
   * Loads and validates every referenced measurement.
   *
   * @return array<\Drupal\bb_core\BbMeasurementInterface>
   *   The referenced measurements in configured order.
   */
  private function loadReferencedMeasurements(): array {
    $measurementStorage = \Drupal::entityTypeManager()->getStorage('bb_measurement');
    $measurements = [];
    foreach ($this->measurements as $measurementId) {
      $measurement = $measurementStorage->load($measurementId);
      if (!$measurement instanceof BbMeasurementInterface) {
        throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" references unknown measurement "%s".', $this->id(), $measurementId));
      }
      $measurements[] = $measurement;
    }
    return $measurements;
  }

  /**
   * Validates the category strategy against the referenced measurements.
   *
   * @param array<\Drupal\bb_core\BbMeasurementInterface> $measurements
   *   The referenced measurements.
   */
  private function validateCategories(array $measurements): void {
    $categoryType = (string) ($this->categories['type'] ?? '');
    if (!in_array($categoryType, ['windows', 'days', 'months', 'dimension', 'total'], TRUE)) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" has unsupported category type "%s".', $this->id(), $categoryType));
    }
    if ($categoryType === 'total' && $this->series !== []) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" cannot expand a total into series.', $this->id()));
    }
    if ($categoryType !== 'dimension') {
      return;
    }
    $dimension = (string) ($this->categories['dimension'] ?? '');
    if ($dimension === '') {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" must define a dimension category key.', $this->id()));
    }
    foreach ($measurements as $measurement) {
      if (!$this->measurementSupportsDimension($measurement, $dimension, [])) {
        throw new \InvalidArgumentException(sprintf('Measurement "%s" does not define dimension "%s" required by bakers.build figure "%s".', $measurement->id(), $dimension, $this->id()));
      }
    }
  }

  /**
   * Validates every configured filter.
   */
  private function validateFilters(): void {
    foreach ($this->filters as $key => $filter) {
      $this->validateFilter((string) $key, $filter);
    }
  }

  /**
   * Validates one filter definition.
   *
   * @param string $key
   *   The filter key.
   * @param array<string, mixed> $filter
   *   The filter definition.
   */
  private function validateFilter(string $key, array $filter): void {
    if (($filter['type'] ?? '') === 'entities') {
      $binding = (string) ($filter['binding'] ?? '');
      if (!in_array($binding, ['epic', 'project', 'team', 'user'], TRUE) || in_array($binding, $this->context_shape, TRUE)) {
        throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" filter "%s" must bind epic, project, team or user outside its context shape.', $this->id(), $key));
      }
      return;
    }
    if ($key !== 'period') {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" has unsupported filter "%s".', $this->id(), $key));
    }
    $options = array_map(static fn(array $option): string => (string) ($option['value'] ?? ''), $filter['options'] ?? []);
    if ($options === [] || in_array('', $options, TRUE) || count($options) !== count(array_unique($options))) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" filter "%s" must define unique non-empty options.', $this->id(), $key));
    }
    // The single `period` filter offers the calendar period kinds.
    if (array_diff($options, PeriodResolver::KINDS) !== []) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" filter "%s" supports only %s options.', $this->id(), $key, implode(', ', PeriodResolver::KINDS)));
    }
    if (!in_array((string) ($filter['default'] ?? ''), $options, TRUE)) {
      throw new \InvalidArgumentException(sprintf('bakers.build figure "%s" filter "%s" default must match one configured option.', $this->id(), $key));
    }
  }

  /**
   * Checks direct or derived measurement support for a dimension.
   *
   * @param \Drupal\bb_core\BbMeasurementInterface $measurement
   *   The measurement being inspected.
   * @param string $dimension
   *   The required dimension key.
   * @param array<string, true> $seen
   *   Measurement IDs already visited in this dependency chain.
   */
  private function measurementSupportsDimension(BbMeasurementInterface $measurement, string $dimension, array $seen): bool {
    $id = (string) $measurement->id();
    if (isset($seen[$id])) {
      return FALSE;
    }
    if (isset($measurement->getDimensions()[$dimension])) {
      return TRUE;
    }
    $operation = $measurement->getOperation();
    if (($operation['type'] ?? '') !== 'divide') {
      return FALSE;
    }
    $seen[$id] = TRUE;
    $storage = \Drupal::entityTypeManager()->getStorage('bb_measurement');
    foreach (['numerator', 'denominator'] as $key) {
      $dependency = $storage->load($operation[$key] ?? '');
      if (!$dependency instanceof BbMeasurementInterface
        || !$this->measurementSupportsDimension($dependency, $dimension, $seen)) {
        return FALSE;
      }
    }
    return TRUE;
  }

}
