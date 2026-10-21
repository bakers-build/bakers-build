<?php

declare(strict_types=1);

namespace Drupal\bb_core\Entity;

use Drupal\Core\Config\Entity\ConfigEntityBase;
use Drupal\Core\Entity\Attribute\ConfigEntityType;
use Drupal\Core\Entity\EntityDeleteForm;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\entity\Routing\AdminHtmlRouteProvider;
use Drupal\bb_core\Form\BbMeasurementForm;
use Drupal\bb_core\BbMeasurementInterface;
use Drupal\bb_core\ListBuilder\BbMeasurementListBuilder;

/**
 * Stores a reusable statistics measurement definition.
 */
#[ConfigEntityType(
  id: 'bb_measurement',
  label: new TranslatableMarkup('bakers.build measurement'),
  label_collection: new TranslatableMarkup('bakers.build measurements'),
  label_singular: new TranslatableMarkup('bakers.build measurement'),
  label_plural: new TranslatableMarkup('bakers.build measurements'),
  config_prefix: 'bb_measurement',
  entity_keys: ['id' => 'id', 'label' => 'label'],
  handlers: [
    'list_builder' => BbMeasurementListBuilder::class,
    'form' => [
      'add' => BbMeasurementForm::class,
      'edit' => BbMeasurementForm::class,
      'delete' => EntityDeleteForm::class,
    ],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
  ],
  links: [
    'add-form' => '/admin/bakers/config/statistics/measurements/add',
    'edit-form' => '/admin/bakers/config/statistics/measurements/{bb_measurement}/edit',
    'delete-form' => '/admin/bakers/config/statistics/measurements/{bb_measurement}/delete',
    'collection' => '/admin/bakers/config/statistics/measurements',
  ],
  admin_permission: 'administer bakers',
  config_export: ['id', 'label', 'value_type', 'unit', 'source', 'operation', 'predicates', 'bindings', 'dimensions'],
)]
final class BbMeasurement extends ConfigEntityBase implements BbMeasurementInterface {

  /**
   * The configuration identifier.
   */
  protected string $id = '';
  /**
   * The display label.
   */
  protected string $label = '';
  /**
   * The result value type.
   */
  protected string $value_type = 'integer';
  /**
   * The result unit.
   */
  protected string $unit = '';
  /**
   * The query source configuration.
   */
  protected array $source = [];
  /**
   * The calculation operation.
   */
  protected array $operation = ['type' => 'count'];
  /**
   * The query predicates.
   */
  protected array $predicates = [];
  /**
   * The context bindings.
   */
  protected array $bindings = [];
  /**
   * The result dimensions.
   */
  protected array $dimensions = [];

  /**
   * {@inheritdoc}
   */
  public function getValueType(): string {
    return $this->value_type;
  }

  /**
   * {@inheritdoc}
   */
  public function getUnit(): string {
    return $this->unit;
  }

  /**
   * {@inheritdoc}
   */
  public function getSource(): array {
    return $this->source;
  }

  /**
   * {@inheritdoc}
   */
  public function getOperation(): array {
    return $this->operation;
  }

  /**
   * {@inheritdoc}
   */
  public function getPredicates(): array {
    return $this->predicates;
  }

  /**
   * {@inheritdoc}
   */
  public function getBindings(): array {
    return $this->bindings;
  }

  /**
   * {@inheritdoc}
   */
  public function getDimensions(): array {
    return $this->dimensions;
  }

  /**
   * {@inheritdoc}
   */
  public function calculateDependencies() {
    parent::calculateDependencies();
    if (($this->operation['type'] ?? '') === 'divide') {
      foreach (['numerator', 'denominator'] as $key) {
        $id = $this->operation[$key] ?? '';
        if ($id !== '') {
          $this->addDependency('config', 'bb_core.bb_measurement.' . $id);
        }
      }
    }
    return $this;
  }

  /**
   * {@inheritdoc}
   *
   * PHPMD combines class metrics when its repository-wide command receives
   * multiple source roots; this method delegates each branch to a validator.
   *
   * @SuppressWarnings("PHPMD.CyclomaticComplexity")
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    $type = $this->operation['type'] ?? '';
    if (!in_array($type, ['count', 'sum', 'divide'], TRUE)) {
      throw new \InvalidArgumentException(sprintf('bakers.build measurement "%s" has unsupported operation "%s".', $this->id(), $type));
    }
    if ($type === 'divide') {
      $this->validateDerivedDependencies($storage);
    }
    elseif (($this->source['entity_type'] ?? '') === '' || ($this->source['time_field'] ?? '') === '') {
      throw new \InvalidArgumentException(sprintf('bakers.build measurement "%s" must define a source entity type and time field.', $this->id()));
    }
    if ($type === 'sum' && ($this->operation['field'] ?? '') === '') {
      throw new \InvalidArgumentException(sprintf('bakers.build measurement "%s" is a sum and must define operation.field.', $this->id()));
    }
    $this->validateBindings();
  }

  /**
   * Validates both dependencies of a derived measurement.
   */
  private function validateDerivedDependencies(EntityStorageInterface $storage): void {
    foreach (['numerator', 'denominator'] as $key) {
      $this->validateDerivedDependency($key, $storage);
    }
  }

  /**
   * Validates one derived dependency.
   */
  private function validateDerivedDependency(string $key, EntityStorageInterface $storage): void {
    $dependencyId = (string) ($this->operation[$key] ?? '');
    if ($dependencyId === '') {
      throw new \InvalidArgumentException(sprintf('bakers.build measurement "%s" must define a %s.', $this->id(), $key));
    }
    if ($dependencyId === $this->id() || $storage->load($dependencyId) === NULL) {
      throw new \InvalidArgumentException(sprintf('bakers.build measurement "%s" references unknown %s measurement "%s".', $this->id(), $key, $dependencyId));
    }
    if ($this->dependencyLeadsTo($dependencyId, (string) $this->id(), $storage, [])) {
      throw new \InvalidArgumentException(sprintf('bakers.build measurement "%s" has a cyclic dependency through "%s".', $this->id(), $dependencyId));
    }
  }

  /**
   * Validates all context binding definitions.
   */
  private function validateBindings(): void {
    foreach ($this->bindings as $context => $binding) {
      if (!in_array($binding['resolver'] ?? '', ['entity_id', 'team_projects', 'workspace_projects'], TRUE)) {
        throw new \InvalidArgumentException(sprintf('bakers.build measurement "%s" has unsupported binding resolver "%s" for context "%s".', $this->id(), $binding['resolver'] ?? '', $context));
      }
      if (($binding['field'] ?? '') === '') {
        throw new \InvalidArgumentException(sprintf('bakers.build measurement "%s" must define a field for context "%s".', $this->id(), $context));
      }
    }
  }

  /**
   * Determines whether a derived dependency reaches a target measurement.
   *
   * @param string $dependencyId
   *   The dependency to inspect.
   * @param string $targetId
   *   The measurement ID that must not be reached.
   * @param \Drupal\Core\Entity\EntityStorageInterface $storage
   *   The measurement storage.
   * @param array<string, true> $seen
   *   Dependencies already visited in this traversal.
   */
  private function dependencyLeadsTo(string $dependencyId, string $targetId, EntityStorageInterface $storage, array $seen): bool {
    if ($dependencyId === $targetId) {
      return TRUE;
    }
    if (isset($seen[$dependencyId])) {
      return FALSE;
    }
    $seen[$dependencyId] = TRUE;
    $dependency = $storage->load($dependencyId);
    if (!$dependency instanceof BbMeasurementInterface) {
      return FALSE;
    }
    $operation = $dependency->getOperation();
    if (($operation['type'] ?? '') !== 'divide') {
      return FALSE;
    }
    foreach (['numerator', 'denominator'] as $key) {
      if ($this->dependencyLeadsTo((string) ($operation[$key] ?? ''), $targetId, $storage, $seen)) {
        return TRUE;
      }
    }
    return FALSE;
  }

}
