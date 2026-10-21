<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Condition;

use Drupal\Core\Condition\Attribute\Condition;
use Drupal\Core\Condition\ConditionPluginBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Matches the current route name against an exact list.
 */
#[Condition(
  id: 'route_name',
  label: new TranslatableMarkup('Route name'),
)]
final class RouteName extends ConditionPluginBase implements ContainerFactoryPluginInterface {

  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    private readonly RouteMatchInterface $routeMatch,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    return new static($configuration, $plugin_id, $plugin_definition, $container->get('current_route_match'));
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration(): array {
    return ['route_names' => []] + parent::defaultConfiguration();
  }

  /**
   * {@inheritdoc}
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state): array {
    $form['route_names'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Route names'),
      '#default_value' => implode("\n", $this->configuration['route_names']),
      '#description' => $this->t('One route machine name per line, for example %route.', ['%route' => 'system.404']),
    ];
    return parent::buildConfigurationForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state): void {
    $this->configuration['route_names'] = preg_split('/\R/', trim((string) $form_state->getValue('route_names')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $this->configuration['route_names'] = array_values(array_map('trim', $this->configuration['route_names']));
    parent::submitConfigurationForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function evaluate(): bool {
    // An unconfigured condition restricts nothing, as core's request_path.
    if ($this->configuration['route_names'] === []) {
      return TRUE;
    }
    return in_array((string) $this->routeMatch->getRouteName(), $this->configuration['route_names'], TRUE);
  }

  /**
   * {@inheritdoc}
   */
  public function summary(): string {
    return (string) $this->t('The route is one of: @routes', ['@routes' => implode(', ', $this->configuration['route_names'])]);
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    return array_merge(parent::getCacheContexts(), ['route']);
  }

}
