<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\Component\Utility\NestedArray;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\PluginBase;

/**
 * Configuration plumbing shared by ticket trigger types.
 */
abstract class TicketTriggerTypeBase extends PluginBase implements BbTicketTriggerTypeInterface {

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $configuration
   *   The plugin configuration.
   * @param string $plugin_id
   *   The plugin ID.
   * @param mixed $plugin_definition
   *   The plugin definition.
   */
  public function __construct(array $configuration, $plugin_id, $plugin_definition) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->setConfiguration($configuration);
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The configuration.
   */
  public function getConfiguration(): array {
    return $this->configuration;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $configuration
   *   The configuration.
   */
  public function setConfiguration(array $configuration): static {
    $this->configuration = $configuration + $this->defaultConfiguration();
    return $this;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The defaults.
   */
  public function defaultConfiguration(): array {
    return [];
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The plugin form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The plugin form.
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state): array {
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The plugin form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function validateConfigurationForm(array &$form, FormStateInterface $form_state): void {
    $candidate = clone $this;
    $candidate->setConfiguration($this->submittedValues($form, $form_state));
    // setError() only reads #parents; a copy keeps $form's own type.
    $element = $form;
    foreach ($candidate->configurationErrors() as $error) {
      $form_state->setError($element, $error);
    }
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The plugin form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state): void {
    $this->configuration = $this->submittedValues($form, $form_state);
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string>
   *   The error messages.
   */
  public function configurationErrors(): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function nextOccurrence(\DateTimeImmutable $after): ?\DateTimeImmutable {
    return NULL;
  }

  /**
   * The values submitted for this plugin's form, keyed by configuration key.
   *
   * @param array<string, mixed> $form
   *   The plugin form, carrying its #parents.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The submitted configuration.
   */
  protected function submittedValues(array $form, FormStateInterface $form_state): array {
    $values = NestedArray::getValue($form_state->getValues(), $form['#parents'] ?? []);
    return is_array($values) ? $values : [];
  }

}
