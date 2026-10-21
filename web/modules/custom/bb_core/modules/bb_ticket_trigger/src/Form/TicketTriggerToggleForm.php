<?php

declare(strict_types=1);

namespace Drupal\bb_ticket_trigger\Form;

use Drupal\Core\Entity\ContentEntityConfirmFormBase;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_ticket_trigger\Entity\BbTicketTriggerInterface;
use Drupal\island\Form\WrappedDialogFormTrait;

/**
 * Pauses an enabled trigger or resumes a paused one.
 *
 * Resuming runs the activation gate like any save: a trigger whose
 * prerequisites went missing stays paused and the reason is shown. Opened
 * from the list it answers in the overlay; without JavaScript, as a page.
 */
final class TicketTriggerToggleForm extends ContentEntityConfirmFormBase {

  use WrappedDialogFormTrait;

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_ticket_trigger_toggle_form';
  }

  /**
   * {@inheritdoc}
   */
  public function getQuestion(): TranslatableMarkup {
    return $this->trigger()->isEnabled()
      ? $this->t('Pause the trigger %label?', ['%label' => $this->trigger()->label()])
      : $this->t('Resume the trigger %label?', ['%label' => $this->trigger()->label()]);
  }

  /**
   * {@inheritdoc}
   */
  public function getDescription(): TranslatableMarkup {
    return $this->trigger()->isEnabled()
      ? $this->t('A paused trigger creates no tickets.')
      : $this->t('Occurrences missed while paused are not caught up on.');
  }

  /**
   * {@inheritdoc}
   */
  public function getConfirmText(): TranslatableMarkup {
    return $this->trigger()->isEnabled() ? $this->t('Pause') : $this->t('Resume');
  }

  /**
   * {@inheritdoc}
   */
  public function getCancelUrl(): Url {
    $trigger = $this->trigger();
    return $trigger->getTargetPlugin()->listUrl($trigger) ?? Url::fromRoute('<front>');
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return \Drupal\Core\Entity\ContentEntityInterface
   *   The trigger with `enabled` flipped.
   */
  public function buildEntity(array $form, FormStateInterface $form_state) {
    $trigger = parent::buildEntity($form, $form_state);
    assert($trigger instanceof BbTicketTriggerInterface);
    $trigger->set('enabled', !$trigger->isEnabled());
    return $trigger;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   *
   * @return array<string, mixed>
   *   The form.
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form = parent::buildForm($form, $form_state);
    // The shell places no messages region; a refused resume shows its reason
    // inside the form, in the dialog as on the page.
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    // A boosted page submit would swap the response instead of following the
    // redirect; in the dialog, Cancel is what the close control and Escape use.
    $form['#attributes']['data-hx-boost'] = 'false';
    if ($this->isDialogRequest()) {
      unset($form['#attributes']['data-hx-boost']);
      $form['actions']['cancel']['#attributes']['data-dialog-cancel'] = 'data-dialog-cancel';
    }
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * The confirm-form base skips entity validation; resuming must not.
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $trigger = $this->buildEntity($form, $form_state);
    assert($trigger instanceof BbTicketTriggerInterface);
    foreach ($trigger->validate() as $violation) {
      $form_state->setErrorByName('', $violation->getMessage());
    }
    // Built once: submitForm() saves this toggled copy.
    $this->setEntity($trigger);
    return $trigger;
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $trigger = $this->trigger();
    $trigger->save();
    $this->messenger()->addStatus($trigger->isEnabled() ? $this->t('The trigger has been resumed.') : $this->t('The trigger has been paused.'));
    if ($this->isDialogRequest() || $this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      $this->respondAtReturnUrl($form_state);
      return;
    }
    $form_state->setRedirectUrl($this->getCancelUrl());
  }

  /**
   * The trigger being toggled.
   */
  private function trigger(): BbTicketTriggerInterface {
    $trigger = $this->getEntity();
    assert($trigger instanceof BbTicketTriggerInterface);
    return $trigger;
  }

}
