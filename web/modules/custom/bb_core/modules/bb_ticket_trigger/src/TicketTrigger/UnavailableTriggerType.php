<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\TicketTrigger;

use Drupal\Core\Form\FormStateInterface;

/**
 * Stands in for a stored trigger type that has no plugin definition.
 *
 * Not discoverable, so no form offers it. It keeps the stored configuration
 * untouched and can never be activated.
 */
final class UnavailableTriggerType extends TicketTriggerTypeBase {

  /**
   * {@inheritdoc}
   */
  public function summary(): string {
    return $this->message();
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string>
   *   The error messages.
   */
  public function configurationErrors(): array {
    return [$this->message()];
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
    $form['unavailable'] = ['#markup' => $this->message()];
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
  public function submitConfigurationForm(array &$form, FormStateInterface $form_state): void {
    // The stored configuration of an unknown type is kept as it is.
  }

  /**
   * The message naming the missing type.
   */
  private function message(): string {
    return (string) $this->t('Unavailable trigger type: @id', ['@id' => $this->getPluginId()]);
  }

}
