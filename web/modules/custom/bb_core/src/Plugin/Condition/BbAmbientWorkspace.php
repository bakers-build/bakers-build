<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Condition;

use Drupal\Core\Condition\Attribute\Condition;
use Drupal\Core\Condition\ConditionPluginBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\Context\EntityContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\ContextProvider\BbRouteContextProvider;
use Drupal\bb_core\Entity\BbWorkspaceInterface;

/**
 * Matches when a workspace resolves for the request.
 */
#[Condition(
  id: 'bb_ambient_workspace',
  label: new TranslatableMarkup('bakers.build workspace resolves'),
  context_definitions: [
    'workspace' => new EntityContextDefinition(
      data_type: 'entity:bb_workspace',
      label: new TranslatableMarkup('Workspace'),
      required: FALSE,
    ),
  ],
)]
final class BbAmbientWorkspace extends ConditionPluginBase {

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration(): array {
    return ['enabled' => FALSE] + parent::defaultConfiguration();
  }

  /**
   * {@inheritdoc}
   */
  public function getContextMapping(): array {
    return array_filter(parent::getContextMapping()) + ['workspace' => BbRouteContextProvider::AMBIENT_WORKSPACE];
  }

  /**
   * {@inheritdoc}
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state): array {
    $form['enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Require a resolved workspace'),
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
    return !$this->configuration['enabled'] || $this->getContextValue('workspace') instanceof BbWorkspaceInterface;
  }

  /**
   * {@inheritdoc}
   */
  public function summary(): string {
    return (string) $this->t('A workspace resolves for the request.');
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts(): array {
    return array_merge(parent::getCacheContexts(), ['bb_workspace']);
  }

}
