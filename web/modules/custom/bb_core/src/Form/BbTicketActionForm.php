<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_core\Entity\BbRunInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\Ticket\TicketInterventions;
use Drupal\island\Form\WrappedDialogFormTrait;

/**
 * Confirms an intervention: freeze, unfreeze, cancel a ticket or a run.
 *
 * Opened from the detail page's Properties footer or a run row, as a dialog
 * over the ticket with JavaScript and as a plain page without it. The page
 * itself writes nothing; only the Confirm submit does, after re-reading the
 * ticket or the named run.
 */
final class BbTicketActionForm extends EntityForm {

  use WrappedDialogFormTrait;

  /**
   * The current ticket.
   *
   * @var \Drupal\bb_core\Entity\BbTicketInterface
   */
  protected $entity;

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $ticket = $this->entity;
    assert($ticket instanceof BbTicketInterface);
    $form['#cache']['max-age'] = 0;
    $this->attachDialogHtmx($form);

    $run = TicketInterventions::runByUuid($this->getRequest()->query->get(TicketInterventions::RUN_PARAMETER), $this->entityTypeManager);
    [$question, $confirm] = $this->confirmation($ticket, $run);
    if (($confirm['#bb_action']['kind'] ?? NULL) === 'ticket') {
      // A submit from any other state is stale and writes nothing.
      $form['bb_from_state'] = ['#type' => 'hidden', '#value' => $confirm['#bb_action']['from']];
    }

    $form['question'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:message',
      '#props' => ['status' => $confirm !== NULL ? 'warning' : 'status'],
      '#slots' => ['body' => ['#plain_text' => (string) $question]],
      '#weight' => -10,
    ];
    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['keep'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => [
        'label' => (string) ($run !== NULL ? $this->t('Keep the run') : $this->t('Keep the ticket')),
        'href' => $ticket->toUrl()->toString(),
        'variant' => 'ghost',
      ],
      '#weight' => 0,
    ];
    if ($confirm !== NULL) {
      $form['actions']['bb_confirm'] = $confirm + ['#weight' => 10];
    }
    return $form;
  }

  /**
   * The question to ask and the Confirm button, when the action is valid now.
   *
   * @return array{0: \Drupal\Core\StringTranslation\TranslatableMarkup, 1: array<string, mixed>|null}
   *   The question, and the button or NULL.
   */
  private function confirmation(BbTicketInterface $ticket, ?BbRunInterface $run): array {
    if ($this->getRequest()->query->has(TicketInterventions::FREEZE_PARAMETER)) {
      return $this->freezeConfirmation($ticket);
    }
    if ($run !== NULL && TicketInterventions::mayCancelRun($run, $ticket)) {
      return [
        $this->t('Run #@run stops. The ticket stays in its current state, and the conductor may start another run.', [
          '@run' => $run->id(),
        ]),
        $this->actionButton('bb_confirm', (string) $this->t('Cancel run'), [
          'kind' => 'run',
          'run' => $run->uuid(),
        ], 'danger'),
      ];
    }
    $asks_for_run = $this->getRequest()->query->get(TicketInterventions::RUN_PARAMETER) !== NULL;
    if ($asks_for_run || !TicketInterventions::mayCancelTicket($ticket)) {
      return [$this->t('This action is no longer available. The ticket shows its current state.'), NULL];
    }
    $action = [
      'kind' => 'ticket',
      'transition' => TicketInterventions::CANCEL,
      'from' => (string) $ticket->getState()->getId(),
    ];
    return [
      $this->t('@ticket becomes cancelled and cannot be reopened. Its active runs stop.', [
        '@ticket' => $ticket->getIdentifier() !== '' ? $ticket->getIdentifier() : (string) $ticket->label(),
      ]),
      $this->actionButton('bb_confirm', (string) $this->t('Cancel ticket'), $action, 'danger'),
    ];
  }

  /**
   * The freeze/unfreeze question and button, when the account may write frozen.
   *
   * @return array{0: \Drupal\Core\StringTranslation\TranslatableMarkup, 1: array<string, mixed>|null}
   *   The question, and the button or NULL.
   */
  private function freezeConfirmation(BbTicketInterface $ticket): array {
    if (!TicketInterventions::mayFreeze($ticket) && !TicketInterventions::mayUnfreeze($ticket)) {
      return [$this->t('This action is no longer available. The ticket shows its current state.'), NULL];
    }
    $frozen = $this->getRequest()->query->get(TicketInterventions::FREEZE_PARAMETER) === '1';
    $label = $ticket->getIdentifier() !== '' ? $ticket->getIdentifier() : (string) $ticket->label();
    $action = ['kind' => 'freeze', 'frozen' => $frozen ? '1' : '0'];
    return $frozen
      ? [
        $this->t('@ticket will not be claimed until it is unfrozen. Its active run is ended.', [
          '@ticket' => $label,
        ]),
        $this->actionButton('bb_confirm', (string) $this->t('Freeze ticket'), $action, 'neutral'),
      ]
      : [
        $this->t('@ticket can be claimed again on the next cycle.', [
          '@ticket' => $label,
        ]),
        $this->actionButton('bb_confirm', (string) $this->t('Unfreeze ticket'), $action, 'neutral'),
      ];
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  protected function copyFormValuesToEntity(EntityInterface $entity, array $form, FormStateInterface $form_state): void {
    // Only the confirm handler writes, and only through the state machine.
  }

  /**
   * Applies the posted transition or run cancellation.
   *
   * Form API submit handler; the form array is part of its signature.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function submitTicketAction(array &$form, FormStateInterface $form_state): void {
    $action = $this->postedAction($form_state);
    $action === NULL ? $this->rejectAction($form_state) : $this->applyAction($action, $form_state);
  }

  /**
   * The triggering button's action, only when that button was really posted.
   *
   * Drupal falls back to the form's first button when the posted one no
   * longer exists. A stale page must not trigger a different action, so the
   * button's own name has to be in the input, and a ticket action has to be
   * posted from the state it was rendered in.
   *
   * @return array<string, string>|null
   *   The action, or NULL for a fallback, forged or stale trigger.
   */
  private function postedAction(FormStateInterface $form_state): ?array {
    $trigger = $form_state->getTriggeringElement();
    $input = $form_state->getUserInput();
    if (!isset($trigger['#bb_action'], $trigger['#name']) || !array_key_exists($trigger['#name'], $input)) {
      return NULL;
    }
    $action = $trigger['#bb_action'];
    if ($action['kind'] === 'ticket' && ($input['bb_from_state'] ?? NULL) !== $action['from']) {
      return NULL;
    }
    return $action;
  }

  /**
   * Re-reads the target, re-checks it and writes only that target.
   *
   * @param array<string, string> $action
   *   The posted action.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The submitted form state.
   */
  private function applyAction(array $action, FormStateInterface $form_state): void {
    $ticket = $this->entityTypeManager->getStorage('bb_ticket')->loadUnchanged($this->entity->id());
    if (!$ticket instanceof BbTicketInterface) {
      $this->rejectAction($form_state);
      return;
    }
    $target = match ($action['kind']) {
      'run' => $this->cancellableRun($action['run'], $ticket),
      'freeze' => $this->freezeTarget($action, $ticket),
      default => $this->transitionTarget($action, $ticket),
    };
    if ($target === NULL || count($target->validate()) > 0) {
      $this->rejectAction($form_state);
      return;
    }
    $target->save();
    $this->messenger()->addStatus($this->statusMessage($action, $ticket));
    $this->respondAtReturnUrl($form_state);
  }

  /**
   * The ticket with the posted freeze target applied, or NULL.
   *
   * @param array<string, string> $action
   *   The posted freeze action.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The freshly loaded ticket.
   */
  private function freezeTarget(array $action, BbTicketInterface $ticket): ?BbTicketInterface {
    if (!TicketInterventions::mayFreeze($ticket) && !TicketInterventions::mayUnfreeze($ticket)) {
      return NULL;
    }
    $ticket->setFrozen($action['frozen'] === '1');
    return $ticket;
  }

  /**
   * The success message for the action that just wrote.
   *
   * @param array<string, string> $action
   *   The posted action.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The ticket that was acted on.
   */
  private function statusMessage(array $action, BbTicketInterface $ticket): string {
    $label = $ticket->getIdentifier() !== '' ? $ticket->getIdentifier() : (string) $ticket->label();
    return match ($action['kind']) {
      'run' => (string) $this->t('The run was cancelled.'),
      'freeze' => $action['frozen'] === '1'
        ? (string) $this->t('@ticket is frozen.', ['@ticket' => $label])
        : (string) $this->t('@ticket is no longer frozen.', ['@ticket' => $label]),
      default => (string) $this->t('@ticket is now @state.', [
        '@ticket' => $label,
        '@state' => (string) $ticket->getState()->getLabel(),
      ]),
    };
  }

  /**
   * The ticket with the transition applied, or NULL when it is not valid now.
   *
   * @param array<string, string> $action
   *   The posted ticket action.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The freshly loaded ticket.
   */
  private function transitionTarget(array $action, BbTicketInterface $ticket): ?BbTicketInterface {
    if (!TicketInterventions::maySetState($ticket) || $action['transition'] !== TicketInterventions::CANCEL) {
      return NULL;
    }
    $state = $ticket->getState();
    if ((string) $state->getId() !== $action['from'] || !$state->isTransitionAllowed($action['transition'])) {
      return NULL;
    }
    $state->applyTransitionById($action['transition']);
    return $ticket;
  }

  /**
   * The named run with its cancellation applied, or NULL.
   */
  private function cancellableRun(string $uuid, BbTicketInterface $ticket): ?BbRunInterface {
    $run = TicketInterventions::runByUuid($uuid, $this->entityTypeManager);
    if ($run === NULL || !TicketInterventions::mayCancelRun($run, $ticket)) {
      return NULL;
    }
    TicketInterventions::runState($run)->applyTransitionById(TicketInterventions::CANCEL);
    return $run;
  }

  /**
   * Reports a refused action and returns to the ticket's current state.
   */
  private function rejectAction(FormStateInterface $form_state): void {
    $this->messenger()->addError($this->t('This action is no longer available. The ticket shows its current state.'));
    $this->respondAtReturnUrl($form_state);
  }

  /**
   * One action button; skips field validation and carries its action.
   *
   * @param string $name
   *   The unique button name.
   * @param string $label
   *   The visible label.
   * @param array<string, string> $action
   *   The action the button stands for.
   * @param string $variant
   *   The `input__submit__bb_button` variant.
   *
   * @return array<string, mixed>
   *   The button element.
   */
  private function actionButton(string $name, string $label, array $action, string $variant): array {
    return [
      '#type' => 'submit',
      '#name' => $name,
      '#value' => $label,
      '#bb_action' => $action,
      '#bb_variant' => $variant,
      '#theme_wrappers' => ['input__submit__bb_button'],
      '#limit_validation_errors' => [],
      '#submit' => ['::submitTicketAction'],
    ];
  }

}
