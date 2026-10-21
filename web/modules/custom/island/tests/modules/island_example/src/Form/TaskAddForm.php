<?php

declare(strict_types=1);

namespace Drupal\island_example\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\island\Form\IslandFormBase;
use Drupal\island\IslandHostResolver;
use Drupal\island\IslandInterface;
use Drupal\island\IslandPluginManagerInterface;
use Drupal\island\IslandResponder;
use Drupal\island\IslandResponse;
use Drupal\island_example\TaskStore;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Demo island form: adds a task.
 */
final class TaskAddForm extends IslandFormBase {

  public function __construct(
    IslandResponder $responder,
    IslandHostResolver $hostResolver,
    IslandPluginManagerInterface $islandManager,
    protected TaskStore $taskStore,
  ) {
    parent::__construct($responder, $hostResolver, $islandManager);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('island.responder'),
      $container->get('island.host_resolver'),
      $container->get('plugin.manager.island'),
      $container->get('island_example.task_store'),
    );
  }

  /**
   * {@inheritdoc}
   */
  protected function buildIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): array {
    $form['title'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Title'),
      // Server-side validation: an HTML5 "required" attribute would let the
      // browser block the submit natively and the island flow would never
      // run.
      '#required' => FALSE,
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
  protected function validateIslandForm(array &$form, FormStateInterface $form_state, IslandInterface $island): void {
    if (trim((string) $form_state->getValue('title')) === '') {
      $form_state->setErrorByName('title', $this->t('Title field is required.'));
    }
  }

  /**
   * {@inheritdoc}
   */
  protected function submitIslandForm(array $form, FormStateInterface $form_state, IslandInterface $island): IslandResponse {
    $this->taskStore->add((string) $form_state->getValue('title'));
    return IslandResponse::make()
      ->rebuildSelf()
      ->dispatch('tasks.changed', ['count' => $this->taskStore->count()]);
  }

}
