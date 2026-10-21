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
 * Matches the account area reached from the person mark.
 */
#[Condition(
  id: 'bb_user_area_route',
  label: new TranslatableMarkup('bakers.build user area route'),
)]
final class BbUserAreaRoute extends ConditionPluginBase implements ContainerFactoryPluginInterface {

  /**
   * The routes reached from the person mark's account area.
   *
   * Another module adds its own route with the route option `_bb_user_area`.
   */
  public const ROUTES = [
    'entity.user.canonical',
    'entity.user.edit_form',
    'view.worklog.personal',
    'bb_track.schedule',
    'entity.bb_track_submission.canonical',
    'view.conductors.user_list',
    'view.machines.user_list',
    'entity.bb_machine.canonical',
    'view.bb_api_keys.page',
    'bb_api_key.add',
    'bb_api_key.delete',
  ];

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
    return ['enabled' => FALSE] + parent::defaultConfiguration();
  }

  /**
   * {@inheritdoc}
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state): array {
    $form['enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Require a user area route'),
      '#default_value' => $this->configuration['enabled'],
    ];
    return parent::buildConfigurationForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state): void {
    $this->configuration['enabled'] = (bool) $form_state->getValue('enabled');
    parent::submitConfigurationForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function evaluate(): bool {
    return !$this->configuration['enabled']
      || in_array((string) $this->routeMatch->getRouteName(), self::ROUTES, TRUE)
      || (bool) $this->routeMatch->getRouteObject()?->getOption('_bb_user_area');
  }

  /**
   * {@inheritdoc}
   */
  public function summary(): string {
    return (string) $this->t('The route belongs to the user area.');
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    return array_merge(parent::getCacheContexts(), ['route']);
  }

}
