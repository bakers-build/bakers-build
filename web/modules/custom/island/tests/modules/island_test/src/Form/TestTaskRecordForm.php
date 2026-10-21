<?php

declare(strict_types=1);

namespace Drupal\island_test\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\island\Form\IslandFormBase;
use Drupal\island\IslandInterface;
use Drupal\island\IslandResponse;
use Drupal\island_test\FormHostProvider;

/**
 * Kernel test form whose submit leaves a mark its own island renders.
 *
 * TestTaskAddForm's submit handler returns an IslandResponse and does nothing
 * else, which is all IslandFormBaseTest needs. The mutation path over HTTP
 * needs more: a submit that never ran and a submit that ran and saved nothing
 * produce the same response, so the fixture has to make the difference
 * visible. This one records the submitted title on its host, and the island
 * renders it.
 */
final class TestTaskRecordForm extends IslandFormBase {

  /**
   * {@inheritdoc}
   */
  protected function buildIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): array {
    $form['title'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Title'),
      '#required' => TRUE,
    ];
    // A second, optional field, so a REFUSED submit has something to keep. The
    // whole point of answering a refusal with the island's own fragment is
    // that the operator's typing survives it, and a form with one required
    // field can only ever be refused empty.
    $form['note'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Note'),
    ];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Record task'),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function submitIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): IslandResponse {
    $host = $this->hostResolver->resolve('forms');
    if ($host instanceof FormHostProvider) {
      $host->record((string) $form_state->getValue('title'));
    }
    return IslandResponse::make()->rebuildSelf();
  }

}
