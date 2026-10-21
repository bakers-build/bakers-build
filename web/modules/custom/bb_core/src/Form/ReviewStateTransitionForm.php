<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\EntityStorageException;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\state_machine\Form\StateTransitionForm;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;

/**
 * The state widget of one review: its state and the viewer's transitions.
 *
 * Rendered in the ticket sidebar but posted to its own route, so the
 * submission and its redirect back to the ticket happen outside the canvas
 * render, where an enforced redirect would surface as an HTTP 500.
 */
final class ReviewStateTransitionForm extends StateTransitionForm {

  /**
   * Badge tones per review state.
   */
  private const TONES = [
    'draft' => 'wait',
    'submitted' => 'attention',
    'accepted' => 'running',
    'rejected' => 'critical',
  ];

  /**
   * The widget of one review's `review_state`.
   */
  public static function forReview(BbCommentInterface $review): self {
    $form = \Drupal::classResolver(self::class);
    assert($form instanceof self);
    $form->setEntity($review);
    $form->setFieldName('review_state');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $form = parent::buildForm($form, $form_state) ?? [];
    $item = $this->stateItem();
    if ($item === NULL) {
      return $form;
    }
    $state = $item->getId();
    $form['#action'] = $this->postUrl()->toString();
    $form['#attributes']['data-bakers-review-widget'] = $state;
    // The state leads the transitions on one line.
    $form['actions']['state'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:badge',
      '#props' => ['label' => (string) $item->getLabel(), 'tone' => self::TONES[$state] ?? 'neutral'],
      '#weight' => -10,
    ];
    $form['review_from'] = ['#type' => 'hidden', '#default_value' => $state];
    foreach ($form['actions'] ?? [] as $id => $button) {
      if (is_array($button) && isset($button['#transition'])) {
        // A distinct name per transition: a POST that names none of them is
        // refused instead of resolving to the first button.
        $form['actions'][$id]['#name'] = $id;
        $form['actions'][$id]['#theme_wrappers'] = ['input__submit__bb_button'];
        $form['actions'][$id]['#bb_variant'] = 'neutral';
      }
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   *
   * A stale, forged or unnamed transition is refused in submitForm(), not
   * here: a validation error would leave the visitor on this route's bare
   * widget page instead of the ticket.
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $trigger = $form_state->getTriggeringElement();
    $transition = $trigger['#transition'] ?? NULL;
    $name = (string) ($trigger['#name'] ?? '');
    $posted = $name !== '' && array_key_exists($name, $form_state->getUserInput());
    $item = $this->stateItem();
    $form_state->set('review_refused', $transition === NULL || !$posted || $item === NULL
      || (string) $form_state->getValue('review_from') !== $item->getId()
      || !$item->isTransitionAllowed($transition->getId()));
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    if ($form_state->get('review_refused')) {
      $this->messenger()->addError($this->t('This review changed or you may no longer change its state.'));
      $this->finish($form_state);
      return;
    }
    try {
      parent::submitForm($form, $form_state);
    }
    catch (EntityStorageException $e) {
      // The lock's own wording names the conflict; anything else is a
      // storage failure whose message may carry SQL.
      $known = str_contains($e->getMessage(), 'changed meanwhile') || str_contains($e->getMessage(), 'current assignee');
      $this->messenger()->addError($known ? $e->getMessage() : $this->t('The review could not be saved. Reload the ticket and try again.'));
      if (!$known) {
        $this->getLogger('bb_core')->error('Review transition failed: @message', ['@message' => $e->getMessage()]);
      }
    }
    $this->finish($form_state);
  }

  /**
   * Back to the review's ticket.
   */
  private function finish(FormStateInterface $form_state): void {
    $ticket = $this->entity->get('ticket_id')->entity;
    TicketNavigation::finishAt($ticket instanceof BbTicketInterface ? $ticket->toUrl() : Url::fromRoute('<front>'), $form_state, $this->getRequest());
  }

  /**
   * The review's transition route in the ticket's workspace.
   */
  private function postUrl(): Url {
    $ticket = $this->entity->get('ticket_id')->entity;
    return Url::fromRoute('bb_core.review_transition', [
      'bb_workspace' => $ticket instanceof BbTicketInterface ? ($ticket->toUrl()->getRouteParameters()['bb_workspace'] ?? NULL) : NULL,
      'bb_comment' => $this->entity->id(),
    ]);
  }

  /**
   * The review's state item, if any.
   */
  private function stateItem(): ?StateItemInterface {
    $item = $this->entity->get($this->fieldName)->first();
    return $item instanceof StateItemInterface ? $item : NULL;
  }

}
