<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbMeasurement;

/**
 * Add/edit form for reusable measurements.
 */
final class BbMeasurementForm extends EntityForm {

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $formState): array {
    $form = parent::form($form, $formState);
    /** @var \Drupal\bb_core\BbMeasurementInterface $measurement */
    $measurement = $this->entity;
    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Label'),
      '#default_value' => $measurement->label(),
      '#required' => TRUE,
    ];
    $form['id'] = [
      '#type' => 'machine_name',
      '#default_value' => $measurement->id(),
      '#machine_name' => ['exists' => [BbMeasurement::class, 'load']],
      '#disabled' => !$measurement->isNew(),
    ];
    $form['value_type'] = [
      '#type' => 'select',
      '#title' => $this->t('Value type'),
      '#options' => [
        'integer' => $this->t('Integer'),
        'decimal' => $this->t('Decimal'),
      ],
      '#default_value' => $measurement->getValueType(),
      '#required' => TRUE,
    ];
    $form['unit'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Unit'),
      '#default_value' => $measurement->getUnit(),
      '#required' => TRUE,
    ];
    $form['definition'] = [
      '#type' => 'details',
      '#title' => $this->t('Calculation definition'),
      '#open' => TRUE,
    ];
    foreach (['source', 'operation', 'predicates', 'bindings', 'dimensions'] as $key) {
      $getter = 'get' . str_replace('_', '', ucwords($key, '_'));
      $form['definition'][$key] = [
        '#type' => 'textarea',
        '#title' => $this->t('@name JSON', ['@name' => ucfirst($key)]),
        '#default_value' => json_encode($measurement->{$getter}(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),
        '#required' => in_array($key, ['source', 'operation'], TRUE),
      ];
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $formState): void {
    parent::validateForm($form, $formState);
    foreach (['source', 'operation', 'predicates', 'bindings', 'dimensions'] as $key) {
      $raw = trim((string) $formState->getValue($key));
      if ($raw === '') {
        $formState->setValue($key, []);
        continue;
      }
      try {
        $formState->setValue($key, json_decode($raw, TRUE, flags: JSON_THROW_ON_ERROR));
      }
      catch (\JsonException $exception) {
        $formState->setErrorByName($key, $this->t('Invalid JSON: @message', ['@message' => $exception->getMessage()]));
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $formState): int {
    $result = $this->entity->save();
    $this->messenger()->addStatus($this->t('Measurement %label saved.', ['%label' => $this->entity->label()]));
    $formState->setRedirectUrl($this->entity->toUrl('collection'));
    return $result;
  }

}
