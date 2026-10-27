<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Component\Plugin\ContextAwarePluginInterface;
use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Form\SubformState;
use Drupal\bb_core\Entity\BbFigure;

/**
 * Add/edit form for server-composed figures.
 */
final class BbFigureForm extends EntityForm {

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $formState): array {
    $form = parent::form($form, $formState);
    /** @var \Drupal\bb_core\BbFigureInterface $figure */
    $figure = $this->entity;
    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Label'),
      '#default_value' => $figure->label(),
      '#required' => TRUE,
    ];
    $form['id'] = [
      '#type' => 'machine_name',
      '#default_value' => $figure->id(),
      '#machine_name' => ['exists' => [BbFigure::class, 'load']],
      '#disabled' => !$figure->isNew(),
    ];
    $form['description'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Description'),
      '#default_value' => $figure->getDescription(),
    ];
    $form['weight'] = [
      '#type' => 'number',
      '#title' => $this->t('Weight'),
      '#default_value' => $figure->getWeight(),
    ];
    $form['widget'] = [
      '#type' => 'select',
      '#title' => $this->t('Widget'),
      '#options' => [
        'matrix' => $this->t('Matrix'),
        'line' => $this->t('Line'),
        'grouped_horizontal_bars' => $this->t('Grouped horizontal bars'),
        'flow' => $this->t('Flow'),
      ],
      '#default_value' => $figure->getWidget(),
      '#required' => TRUE,
    ];
    $form['measurements'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Measurement IDs'),
      '#description' => $this->t('One ID per line, in display order.'),
      '#default_value' => implode("\n", $figure->getMeasurements()),
      '#required' => TRUE,
    ];
    $form['context_shape'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Exact context keys'),
      '#description' => $this->t('One route context key per line.'),
      '#default_value' => implode("\n", $figure->getContextShape()),
    ];
    foreach (['categories', 'filters'] as $key) {
      $getter = $key === 'categories' ? 'getCategories' : 'getFilters';
      $form[$key] = [
        '#type' => 'textarea',
        '#title' => $this->t('@name JSON', ['@name' => ucfirst($key)]),
        '#default_value' => json_encode(
          $figure->{$getter}(),
          JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES,
        ),
        '#required' => $key === 'categories',
      ];
    }
    $form['conditions'] = [
      '#type' => 'details',
      '#title' => $this->t('Applicability conditions'),
      '#tree' => TRUE,
      '#open' => TRUE,
    ];
    foreach ($figure->getConditionConfiguration() as $conditionId => $configuration) {
      $condition = $figure->getCondition($conditionId);
      $formState->set(['bb_figure_conditions', $conditionId], $condition);
      $conditionForm = $condition->buildConfigurationForm([], $formState);
      $conditionForm['#type'] = 'details';
      $definition = $condition->getPluginDefinition();
      $conditionForm['#title'] = is_array($definition)
        ? $definition['label']
        : $condition->getPluginId();
      if ($condition instanceof ContextAwarePluginInterface) {
        $conditionForm['context_mapping'] = [
          '#type' => 'fieldset',
          '#title' => $this->t('Context mappings'),
          '#tree' => TRUE,
        ];
        foreach ($condition->getContextDefinitions() as $name => $definition) {
          $conditionForm['context_mapping'][$name] = [
            '#type' => 'textfield',
            '#title' => $definition->getLabel() ?: $name,
            '#default_value' => $configuration['context_mapping'][$name] ?? '',
            '#required' => $definition->isRequired(),
          ];
        }
      }
      $form['conditions'][$conditionId] = $conditionForm;
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $formState): void {
    parent::validateForm($form, $formState);
    foreach (['categories', 'filters'] as $key) {
      try {
        $formState->setValue($key, json_decode((string) $formState->getValue($key), TRUE, flags: JSON_THROW_ON_ERROR));
      }
      catch (\JsonException $exception) {
        $formState->setErrorByName($key, $this->t('Invalid JSON: @message', ['@message' => $exception->getMessage()]));
      }
    }
    foreach (array_keys($form['conditions'] ?? []) as $conditionId) {
      if (str_starts_with((string) $conditionId, '#')) {
        continue;
      }
      $condition = $formState->get(['bb_figure_conditions', $conditionId]);
      if ($condition !== NULL) {
        $subformState = SubformState::createForSubform(
          $form['conditions'][$conditionId],
          $form,
          $formState,
        );
        $condition->validateConfigurationForm(
          $form['conditions'][$conditionId],
          $subformState,
        );
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $formState): void {
    $formState->setValue('measurements', $this->lines((string) $formState->getValue('measurements')));
    $formState->setValue('context_shape', $this->lines((string) $formState->getValue('context_shape')));
    foreach (array_keys($form['conditions'] ?? []) as $conditionId) {
      if (str_starts_with((string) $conditionId, '#')) {
        continue;
      }
      $condition = $formState->get(['bb_figure_conditions', $conditionId]);
      if ($condition === NULL) {
        continue;
      }
      $subformState = SubformState::createForSubform($form['conditions'][$conditionId], $form, $formState);
      $condition->submitConfigurationForm($form['conditions'][$conditionId], $subformState);
      if ($condition instanceof ContextAwarePluginInterface) {
        $condition->setContextMapping($subformState->getValue('context_mapping', []));
      }
    }
    parent::submitForm($form, $formState);
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $formState): int {
    $result = $this->entity->save();
    $this->messenger()->addStatus($this->t('Figure %label saved.', ['%label' => $this->entity->label()]));
    $formState->setRedirectUrl($this->entity->toUrl('collection'));
    return $result;
  }

  /**
   * Splits a textarea value into non-empty lines.
   *
   * @return array<string>
   *   The trimmed lines.
   */
  private function lines(string $value): array {
    return array_values(array_filter(array_map('trim', preg_split('/\R/', $value) ?: [])));
  }

}
