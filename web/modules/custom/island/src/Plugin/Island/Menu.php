<?php

declare(strict_types=1);

namespace Drupal\island\Plugin\Island;

use Drupal\Component\Plugin\ConfigurableInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Menu\MenuTreeParameters;
use Drupal\Core\Menu\MenuLinkTreeInterface;
use Drupal\Core\Plugin\ConfigurableTrait;
use Drupal\Core\Render\RendererInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Access\CsrfTokenGenerator;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\island\Attribute\Island;
use Drupal\island\IslandPluginBase;
use Drupal\island\IslandBoost;
use Drupal\island\IslandProfileHost;
use Drupal\island\IslandRuntimeId;
use Drupal\island\IslandPluginManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Renders a Drupal menu as an island.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 */
#[Island(
  id: 'menu',
  label: new TranslatableMarkup('Menu'),
  description: new TranslatableMarkup('Renders a Drupal navigation menu.'),
  type: 'menu',
)]
final class Menu extends IslandPluginBase implements ConfigurableInterface {

  use ConfigurableTrait;

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    EntityTypeManagerInterface $entityTypeManager,
    RendererInterface $renderer,
    FormBuilderInterface $formBuilder,
    IslandPluginManagerInterface $islandManager,
    LoggerInterface $logger,
    CsrfTokenGenerator $csrfToken,
    RequestStack $requestStack,
    private readonly MenuLinkTreeInterface $menuTree,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition, $entityTypeManager, $renderer, $formBuilder, $islandManager, $logger, $csrfToken, $requestStack);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static(
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
      $container->get('menu.link_tree'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration(): array {
    return [
      'menu_name' => 'main',
      'depth' => 0,
      'expanded' => FALSE,
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function boost(): ?IslandBoost {
    $host = $this->configuration['contexts']['host'] ?? NULL;
    if (!$host instanceof IslandProfileHost) {
      return NULL;
    }
    foreach ($host->getProfile()->getEnabledPlacements() as $placement_id => $placement) {
      if (($placement['plugin_id'] ?? '') === 'page_content') {
        return IslandBoost::to('#' . IslandRuntimeId::forPlacement(
          (string) $host->getApp()->id(), (string) $host->getProfile()->id(), $host->getInstanceId(), $placement_id,
        ));
      }
    }
    return NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function build(array $data = [], array $options = []): array {
    $configuration = $this->getConfiguration() + $this->defaultConfiguration();
    $menu_name = trim((string) $configuration['menu_name']);
    if ($menu_name === '') {
      return [];
    }

    $parameters = new MenuTreeParameters();
    $depth = (int) $configuration['depth'];
    if ($depth > 0) {
      $parameters->setMaxDepth($depth);
    }
    if (!empty($configuration['expanded'])) {
      $parameters->expandedParents = [];
    }

    $tree = $this->menuTree->load($menu_name, $parameters);
    $tree = $this->menuTree->transform($tree, [
      ['callable' => 'menu.default_tree_manipulators:checkAccess'],
      ['callable' => 'menu.default_tree_manipulators:generateIndexAndSort'],
    ]);
    return $this->menuTree->build($tree);
  }

  /**
   * {@inheritdoc}
   */
  public function settingsForm(array $form, FormStateInterface $form_state): array {
    $configuration = $this->getConfiguration() + $this->defaultConfiguration();
    $menu_options = [];
    foreach ($this->entityTypeManager->getStorage('menu')->loadMultiple() as $menu) {
      $menu_options[$menu->id()] = $menu->label();
    }
    $form['menu_name'] = [
      '#type' => 'select',
      '#title' => $this->t('Menu'),
      '#options' => $menu_options,
      '#default_value' => $configuration['menu_name'],
      '#required' => TRUE,
    ];
    $form['depth'] = [
      '#type' => 'number',
      '#title' => $this->t('Maximum depth'),
      '#default_value' => $configuration['depth'],
      '#min' => 0,
    ];
    $form['expanded'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Expand all menu items'),
      '#default_value' => $configuration['expanded'],
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsSubmit(array $form, FormStateInterface $form_state): void {
    $this->setConfiguration([
      'menu_name' => $form_state->getValue('menu_name'),
      'depth' => max(0, (int) $form_state->getValue('depth')),
      'expanded' => (bool) $form_state->getValue('expanded'),
    ]);
  }

}
