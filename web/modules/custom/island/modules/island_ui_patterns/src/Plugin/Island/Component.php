<?php

declare(strict_types=1);

namespace Drupal\island_ui_patterns\Plugin\Island;

use Drupal\Component\Plugin\ConfigurableInterface;
use Drupal\Component\Plugin\DependentPluginInterface;
use Drupal\Component\Plugin\PluginManagerInterface;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Plugin\ConfigurableTrait;
use Drupal\Core\Plugin\Context\ContextInterface;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandBoost;
use Drupal\island\IslandEvent;
use Drupal\island\IslandConfigurationValidationInterface;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandProfileHost;
use Drupal\island\IslandRuntimeId;
use Psr\Log\LoggerInterface;
use Drupal\ui_patterns\Element\ComponentElementBuilder;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Renders a configured UI Patterns component as an island placement.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 */
#[Island(
  id: 'ui_patterns_component',
  label: new TranslatableMarkup('UI Patterns component'),
  description: new TranslatableMarkup('Renders a selected SDC component with configured props and slots.'),
  type: 'component',
  modules: ['island_ui_patterns'],
)]
final class Component extends IslandPluginBase implements ConfigurableInterface, DependentPluginInterface, IslandConfigurationValidationInterface {

  use ConfigurableTrait;

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    EntityTypeManagerInterface $entity_type_manager,
    RendererInterface $renderer,
    FormBuilderInterface $form_builder,
    IslandPluginManagerInterface $island_manager,
    LoggerInterface $logger,
    CsrfTokenGenerator $csrf_token,
    RequestStack $request_stack,
    ComponentElementBuilder $component_element_builder,
  ) {
    parent::__construct(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $entity_type_manager,
      $renderer,
      $form_builder,
      $island_manager,
      $logger,
      $csrf_token,
      $request_stack,
    );
    $this->componentElementBuilder = $component_element_builder;
  }

  /**
   * The UI Patterns source resolver.
   */
  private ComponentElementBuilder $componentElementBuilder;

  /**
   * Source discovery for dependency tracking.
   */
  protected PluginManagerInterface $sourceManager;

  /**
   * Core component discovery for configuration validation.
   */
  protected PluginManagerInterface $componentManager;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('renderer'),
      $container->get('form_builder'),
      $container->get('plugin.manager.island'),
      $container->get('logger.factory')->get('island'),
      $container->get('csrf_token'),
      $container->get('request_stack'),
      $container->get('ui_patterns.component_element_builder'),
    );
    $instance->sourceManager = $container->get('plugin.manager.ui_patterns_source');
    $instance->componentManager = $container->get('plugin.manager.sdc');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration(): array {
    return [
      'component' => [
        'component_id' => '',
        'variant_id' => NULL,
        'props' => [],
        'slots' => [],
      ],
      'boost' => FALSE,
      'swap_target' => '',
      'target_placement' => '',
      'also_placements' => [],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function calculateDependencies(): array {
    $component = $this->configuration['component'] ?? [];
    $dependencies = $this->componentElementBuilder->calculateComponentDependencies(
      $component['component_id'] ?? NULL, $component,
    );
    $dependencies['module'] = array_values(array_unique(array_merge(
      $dependencies['module'] ?? [], $this->sourceProviders($component),
    )));
    return $dependencies;
  }

  /**
   * {@inheritdoc}
   */
  public function configurationErrors(): array {
    $component = $this->configuration['component'] ?? [];
    if (empty($component['component_id'])) {
      return [(string) $this->t('Select a component before saving this placement.')];
    }
    return $this->mappingErrors($component);
  }

  /**
   * Checks component and source identifiers throughout a mapping tree.
   *
   * @return string[]
   *   Errors naming the unavailable providers.
   */
  private function mappingErrors(array $configuration): array {
    $errors = [];
    foreach (['component_id' => $this->componentManager, 'source_id' => $this->sourceManager] as $key => $manager) {
      if (isset($configuration[$key]) && !$manager->hasDefinition((string) $configuration[$key])) {
        $errors[] = (string) $this->t('Configured provider @id is unavailable. Restore its module or remove this placement.', ['@id' => $configuration[$key]]);
      }
    }
    foreach ($configuration as $value) {
      if (is_array($value)) {
        $errors = array_merge($errors, $this->mappingErrors($value));
      }
    }
    return array_values(array_unique($errors));
  }

  /**
   * Finds module providers of all configured sources, including nested slots.
   *
   * @return string[]
   *   Source provider module IDs.
   */
  private function sourceProviders(array $configuration): array {
    $providers = [];
    $source_id = $configuration['source_id'] ?? '';
    if (is_string($source_id) && $source_id !== '' && $this->sourceManager->hasDefinition($source_id)) {
      $definition = $this->sourceManager->getDefinition($source_id);
      if (is_array($definition) && isset($definition['provider']) && $definition['provider'] !== 'core') {
        $providers[] = $definition['provider'];
      }
    }
    foreach ($configuration as $value) {
      if (is_array($value)) {
        $providers = array_merge($providers, $this->sourceProviders($value));
      }
    }
    return array_values(array_unique($providers));
  }

  /**
   * {@inheritdoc}
   */
  public function boost(): ?IslandBoost {
    $configuration = $this->getConfiguration() + $this->defaultConfiguration();
    if (!(bool) $configuration['boost']) {
      return NULL;
    }

    $target = trim((string) $configuration['swap_target']);
    $target_placement = trim((string) $configuration['target_placement']);
    $host = $this->configuration['contexts']['host'] ?? NULL;
    if ($target === '' && $target_placement !== '' && $host instanceof IslandProfileHost) {
      $app = $host->getApp();
      $profile = $host->getProfile();
      $target = '#' . IslandRuntimeId::forPlacement(
        (string) $app->id(),
        (string) $profile->id(),
        $host->getInstanceId(),
        $target_placement,
      );
    }

    $boost = IslandBoost::to($target === '' ? NULL : $target);
    $also = $configuration['also_placements'] ?? [];
    if ($host instanceof IslandProfileHost && $also !== []) {
      $app = $host->getApp();
      $profile = $host->getProfile();
      foreach ($also as $placement_id) {
        $boost->also(IslandRuntimeId::forPlacement(
          (string) $app->id(),
          (string) $profile->id(),
          $host->getInstanceId(),
          (string) $placement_id,
        ));
      }
    }
    return $boost;
  }

  /**
   * {@inheritdoc}
   */
  public function getSubscribedEvents(): array {
    $host = $this->configuration['contexts']['host'] ?? NULL;
    return $host instanceof IslandProfileHost
      ? array_fill_keys($host->getPlacementEvents($this->getRuntimeIslandId()), 'onAppDataChanged')
      : [];
  }

  /**
   * Rebuilds mappings from the host's current data after an app event.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function onAppDataChanged(IslandEvent $event): array {
    $host = $this->configuration['contexts']['host'] ?? NULL;
    return $host instanceof IslandProfileHost
      ? $this->build($host->getIslandData($this->getRuntimeIslandId()))
      : [];
  }

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $configuration = $this->getConfiguration() + $this->defaultConfiguration();
    $component = is_array($configuration['component']) ? $configuration['component'] : [];
    $component_id = (string) ($component['component_id'] ?? '');
    if ($component_id === '') {
      return [];
    }
    $source = [
      'source_id' => 'component',
      'source' => ['component' => $component],
    ];
    $contexts = array_filter(
      (array) ($data['contexts'] ?? []) + ($this->configuration['contexts'] ?? []),
      static fn($context): bool => $context instanceof ContextInterface,
    );
    $build = $this->componentElementBuilder->buildSource(
      [],
      'content',
      [],
      $source,
      $contexts,
    );
    if (is_array($build) && isset($build['#slots']['content'][0]) && is_array($build['#slots']['content'][0])) {
      return $build['#slots']['content'][0];
    }
    return is_array($build) ? $build : [];
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $configuration = $this->getConfiguration() + $this->defaultConfiguration();
    $errors = $this->configurationErrors();
    if (!empty($configuration['component']['component_id']) && $errors !== []) {
      $form['component'] = ['#type' => 'value', '#value' => $configuration['component']];
      $form['warning'] = ['#markup' => implode(' ', $errors)];
      return $form;
    }
    $form['component'] = [
      '#type' => 'component_form',
      '#title' => $this->t('Component mapping'),
      '#default_value' => $configuration['component'],
      '#source_contexts' => array_filter(
        $this->configuration['contexts'] ?? [],
        static fn($context): bool => $context instanceof ContextInterface,
      ),
      '#render_sources' => TRUE,
      '#render_slots' => TRUE,
    ];
    $form['boost'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Boost links inside this component'),
      '#default_value' => (bool) ($configuration['boost'] ?? FALSE),
    ];
    $form['swap_target'] = [
      '#type' => 'textfield',
      '#title' => $this->t('HTMX swap target'),
      '#default_value' => (string) ($configuration['swap_target'] ?? ''),
      '#description' => $this->t('Optional CSS selector. Leave empty to target this component; use a target placement for profile-scoped IDs.'),
    ];
    $form['target_placement'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Target placement'),
      '#default_value' => (string) ($configuration['target_placement'] ?? ''),
      '#description' => $this->t('Optional profile placement ID used to derive a repeated-instance-safe target.'),
    ];
    return $form;
  }

}
