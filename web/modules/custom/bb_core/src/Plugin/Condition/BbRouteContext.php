<?php

declare(strict_types=1);

namespace Drupal\bb_core\Plugin\Condition;

use Drupal\Core\Condition\Attribute\Condition;
use Drupal\Core\Condition\ConditionPluginBase;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\Context\ContextDefinition;
use Drupal\Core\StringTranslation\TranslatableMarkup;

/**
 * Checks that one explicitly mapped bakers.build route context is present and typed.
 */
#[Condition(
  id: 'bb_route_context',
  label: new TranslatableMarkup('bakers.build route context'),
  context_definitions: [
    'entity' => new ContextDefinition(
      data_type: 'any',
      label: new TranslatableMarkup('Route entity'),
    ),
  ],
)]
final class BbRouteContext extends ConditionPluginBase {

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration(): array {
    return ['entity_type' => ''] + parent::defaultConfiguration();
  }

  /**
   * {@inheritdoc}
   */
  public function buildConfigurationForm(array $form, FormStateInterface $formState): array {
    $form['entity_type'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Required entity type'),
      '#default_value' => $this->configuration['entity_type'],
      '#required' => TRUE,
    ];
    return parent::buildConfigurationForm($form, $formState);
  }

  /**
   * {@inheritdoc}
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $formState): void {
    $this->configuration['entity_type'] = trim((string) $formState->getValue('entity_type'));
    parent::submitConfigurationForm($form, $formState);
  }

  /**
   * {@inheritdoc}
   */
  public function evaluate(): bool {
    $value = $this->getContextValue('entity');
    return $value instanceof EntityInterface
      && $value->getEntityTypeId() === $this->configuration['entity_type'];
  }

  /**
   * {@inheritdoc}
   */
  public function summary(): string {
    return (string) $this->t('The mapped route context is a %type entity.', [
      '%type' => $this->configuration['entity_type'],
    ]);
  }

}
