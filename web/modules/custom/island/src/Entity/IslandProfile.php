<?php

declare(strict_types=1);

namespace Drupal\island\Entity;

use Drupal\Core\Config\Entity\ConfigEntityBase;
use Drupal\Component\Plugin\Exception\PluginException;
use Drupal\Component\Plugin\PluginInspectionInterface;
use Drupal\Core\Entity\Attribute\ConfigEntityType;
use Drupal\Core\Entity\EntityDeleteForm;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Entity\Routing\AdminHtmlRouteProvider;
use Drupal\island\Form\IslandProfileForm;
use Drupal\island\ListBuilder\IslandProfileListBuilder;

/**
 * Defines an app-owned, SDC-backed island profile.
 */
#[ConfigEntityType(
  id: 'island_profile',
  label: new TranslatableMarkup('Island profile'),
  label_collection: new TranslatableMarkup('Island profiles'),
  label_singular: new TranslatableMarkup('island profile'),
  label_plural: new TranslatableMarkup('island profiles'),
  config_prefix: 'profile',
  entity_keys: ['id' => 'id', 'label' => 'label'],
  handlers: [
    'list_builder' => IslandProfileListBuilder::class,
    'form' => [
      'add' => IslandProfileForm::class,
      'edit' => IslandProfileForm::class,
      'delete' => EntityDeleteForm::class,
    ],
    'route_provider' => ['html' => AdminHtmlRouteProvider::class],
  ],
  links: [
    'add-form' => '/admin/structure/island/profiles/add',
    'edit-form' => '/admin/structure/island/profiles/{island_profile}/edit',
    'delete-form' => '/admin/structure/island/profiles/{island_profile}/delete',
    'collection' => '/admin/structure/island/profiles',
  ],
  admin_permission: 'administer island profiles',
  config_export: [
    'id',
    'label',
    'status',
    'app',
    'layout',
    'layout_settings',
    'placements',
    'weight',
    'condition_operator',
    'conditions',
  ],
)]
final class IslandProfile extends ConfigEntityBase implements IslandProfileInterface {

  /**
   * The machine name.
   */
  protected string $id = '';

  /**
   * The human-readable label.
   */
  protected string $label = '';

  /**
   * Whether the profile participates in selection.
   *
   * @var bool
   */
  protected $status = TRUE;

  /**
   * The owning app id.
   */
  protected string $app = '';

  /**
   * The selected SDC component id.
   */
  protected string $layout = '';

  /**
   * Props passed to the layout component.
   */
  protected array $layout_settings = [];

  /**
   * Stable placement records keyed by placement id.
   */
  protected array $placements = [];

  /**
   * Selection priority.
   */
  protected int $weight = 0;

  /**
   * Condition plugin configurations that select this profile.
   */
  protected array $conditions = [];

  /**
   * How the profile conditions combine: 'and' or 'or'.
   */
  protected string $condition_operator = 'and';

  /**
   * {@inheritdoc}
   */
  public function calculateDependencies(): static {
    parent::calculateDependencies();
    if ($this->app !== '') {
      $this->addDependency('config', 'island.app.' . $this->app);
    }
    // Config entities are constructed by entity storage, so dependency
    // discovery follows core's config-entity plugin manager lookup idiom.
    $components = \Drupal::service('plugin.manager.sdc');
    if ($this->layout !== '' && $components->hasDefinition($this->layout)) {
      $this->calculatePluginDependencies($components->createInstance($this->layout));
    }
    $this->calculateConditionDependencies();
    $islands = \Drupal::service('plugin.manager.island');
    foreach ($this->placements as $placement) {
      try {
        $plugin = $islands->createInstance($placement['plugin_id'] ?? '', $placement['configuration'] ?? []);
      }
      catch (PluginException) {
        // Keep unavailable plugin settings intact so the administration form
        // can report and repair them without silently removing placements.
        continue;
      }
      if ($plugin instanceof PluginInspectionInterface) {
        $this->calculatePluginDependencies($plugin);
      }
    }
    return $this;
  }

  /**
   * Adds the providers of profile and placement conditions as dependencies.
   */
  private function calculateConditionDependencies(): void {
    $conditions = \Drupal::service('plugin.manager.condition');
    foreach ([$this->conditions, ...array_column($this->placements, 'conditions')] as $collection) {
      foreach ($collection as $condition) {
        try {
          $plugin = $conditions->createInstance($condition['id'] ?? '', $condition);
        }
        catch (PluginException) {
          // Evaluation denies an unavailable condition; keep it for repair.
          continue;
        }
        if ($plugin instanceof PluginInspectionInterface) {
          $this->calculatePluginDependencies($plugin);
        }
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getAppId(): string {
    return $this->app;
  }

  /**
   * {@inheritdoc}
   */
  public function getConditions(): array {
    return $this->conditions;
  }

  /**
   * {@inheritdoc}
   */
  public function getConditionOperator(): string {
    return $this->condition_operator;
  }

  /**
   * {@inheritdoc}
   */
  public function getLayoutId(): string {
    return $this->layout;
  }

  /**
   * {@inheritdoc}
   */
  public function getLayoutSettings(): array {
    return $this->layout_settings;
  }

  /**
   * {@inheritdoc}
   */
  public function getPlacement(string $placement_id): array {
    $placement = $this->placements[$placement_id] ?? [];
    $placement['id'] ??= $placement_id;
    $placement['slot'] ??= '';
    $placement['weight'] ??= 0;
    $placement['enabled'] ??= TRUE;
    $placement['configuration'] ??= [];
    $placement['conditions'] ??= [];
    $placement['condition_operator'] ??= 'and';
    return $placement;
  }

  /**
   * {@inheritdoc}
   */
  public function getEnabledPlacements(): array {
    return array_filter($this->placements, static fn(array $placement): bool => ($placement['enabled'] ?? TRUE) === TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function getUnassignedPlacements(array $slots): array {
    return array_filter(
      $this->placements,
      static fn(array $placement): bool => !isset($slots[$placement['slot'] ?? '']),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getPlacementsBySlot(): array {
    $grouped = [];
    foreach ($this->placements as $placement_id => $placement) {
      $placement['id'] = $placement_id;
      $placement['weight'] ??= 0;
      $placement['enabled'] ??= TRUE;
      $grouped[$placement['slot'] ?? ''][$placement_id] = $placement;
    }
    foreach ($grouped as &$placements) {
      uasort($placements, static fn(array $a, array $b): int => [$a['weight'], $a['id']] <=> [$b['weight'], $b['id']]);
    }
    unset($placements);
    return $grouped;
  }

}
