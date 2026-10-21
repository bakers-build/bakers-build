<?php

declare(strict_types=1);

namespace Drupal\island_test\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\island\Form\IslandFormBase;
use Drupal\island\IslandInterface;
use Drupal\island\IslandResponse;

/**
 * Kernel/e2e test form: adds a task title.
 */
final class TestTaskAddForm extends IslandFormBase {

  /**
   * {@inheritdoc}
   */
  protected function buildIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): array {
    $form['title'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Title'),
      '#required' => TRUE,
    ];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Add task'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function submitIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): IslandResponse {
    return IslandResponse::make()
      ->rebuildSelf()
      ->dispatch('tasks.changed', ['count' => 4]);
  }

}
