<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Htmx\Htmx;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbCommentInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\island\Form\WrappedDialogFormTrait;
use Drupal\state_machine\Plugin\Field\FieldType\StateItemInterface;

/**
 * Draft and decision form for a review comment.
 *
 * Save draft keeps the unpublished draft. Submit review, Accept and Reject
 * are explicit buttons that apply only the transitions the state machine
 * still allows for this actor, so ticket-edit rights never expose a
 * forbidden decision.
 */
final class BbReviewCommentForm extends BbContentEntityFormBase {

  use WrappedDialogFormTrait {
    returnUrl as private destinationUrl;
  }

  /**
   * Fields the reviewer and assignee never author on this form.
   *
   * @var list<string>
   */
  private const HIDDEN_FIELDS = [
    'ticket_id',
    'author',
    'created',
    'type',
    'status',
    'review_state',
    'submitted_at',
    'decided_at',
    'decided_by',
  ];

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $this->bindTicket();
    $form = parent::form($form, $form_state);
    $this->attachDialogHtmx($form);
    $comment = $this->reviewComment();
    foreach (self::HIDDEN_FIELDS as $name) {
      if (isset($form[$name])) {
        $form[$name]['#access'] = FALSE;
      }
    }
    $state = (string) $comment->get('review_state')->value;
    if ($state !== '' && $state !== 'draft' && isset($form['body'])) {
      $form['body']['#disabled'] = TRUE;
    }
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    $comment = $this->reviewComment();
    $state = (string) $comment->get('review_state')->value;
    if ($state === '' || $state === 'draft') {
      $actions['submit']['#value'] = $this->t('Save draft');
      $actions['submit']['#theme_wrappers'] = ['input__submit__bb_button'];
      if ($this->transitionAllowed('submit')) {
        $actions['submit_review'] = [
          '#type' => 'submit',
          '#value' => $this->t('Submit review'),
          '#submit' => ['::submitForm', '::save'],
          '#submit_review' => TRUE,
          '#theme_wrappers' => ['input__submit__bb_button'],
        ];
      }
      return $actions;
    }
    unset($actions['submit']);
    foreach (['accept' => $this->t('Accept'), 'reject' => $this->t('Reject')] as $id => $label) {
      if (!$this->transitionAllowed($id)) {
        continue;
      }
      $actions[$id] = [
        '#type' => 'submit',
        '#value' => $label,
        '#submit' => ['::submitForm', '::save'],
        '#review_transition' => $id,
        '#theme_wrappers' => ['input__submit__bb_button'],
      ];
    }
    return $actions;
  }

  /**
   * {@inheritdoc}
   *
   * A transition the actor may no longer apply (reviewer removed, review
   * decided in another tab) is an error, never a silent draft save.
   */
  public function validateForm(array &$form, FormStateInterface $form_state): ContentEntityInterface {
    $entity = parent::validateForm($form, $form_state);
    $trigger = $form_state->getTriggeringElement();
    $transition = !empty($trigger['#submit_review']) ? 'submit' : ($trigger['#review_transition'] ?? NULL);
    if (!self::postedTrigger($form_state)) {
      $form_state->setErrorByName('', $this->t('This review changed or you may no longer save it. Reload the ticket.'));
      return $entity;
    }
    if ($this->reviewComment()->isNew()) {
      return $entity;
    }
    $stored = $this->entityTypeManager->getStorage('bb_comment')->loadUnchanged($this->reviewComment()->id());
    $item = $stored instanceof BbCommentInterface ? $stored->get('review_state')->first() : NULL;
    // The form was built from a state another tab has since left.
    $changed = !$item instanceof StateItemInterface
      || $item->getId() !== (string) $this->reviewComment()->get('review_state')->value;
    if ($changed || (is_string($transition) && !$item->isTransitionAllowed($transition))) {
      $form_state->setErrorByName('', $this->t('This review changed or you may no longer @action it. Reload the ticket.', [
        '@action' => is_string($transition) ? $transition : 'save',
      ]));
    }
    return $entity;
  }

  /**
   * Whether the POST named the button that triggered it.
   *
   * Core falls back to the first button when none matches the POST; on a
   * review rebuilt from another state that button can be Accept.
   */
  private static function postedTrigger(FormStateInterface $form_state): bool {
    $trigger = $form_state->getTriggeringElement();
    if (!isset($trigger['#value'])) {
      return TRUE;
    }
    $input = $form_state->getUserInput();
    return (string) ($input[(string) ($trigger['#name'] ?? 'op')] ?? '') === (string) $trigger['#value'];
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $comment = $this->reviewComment();
    $trigger = $form_state->getTriggeringElement();
    $submit_review = !empty($trigger['#submit_review']);
    $transition = $trigger['#review_transition'] ?? NULL;
    if ($comment->isNew()) {
      $result = parent::save($form, $form_state);
      if ($submit_review) {
        $this->applyAllowed('submit');
        $comment->save();
      }
      $this->respondAtReturnUrl($form_state);
      return $result;
    }
    if ($submit_review) {
      $this->applyAllowed('submit');
    }
    if (is_string($transition)) {
      $this->applyAllowed($transition);
    }
    $result = parent::save($form, $form_state);
    $this->respondAtReturnUrl($form_state);
    return $result;
  }

  /**
   * A button opening a review form in the dialog, as a page link without JS.
   *
   * @return array<string, mixed>
   *   The button render array.
   */
  public static function dialogTrigger(string $label, Url $page): array {
    $dialog = (clone $page)->mergeOptions(['query' => ['_wrapper_format' => 'island_dialog']]);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#attached' => ['library' => ['core/drupal.htmx']],
      '#props' => [
        'label' => $label,
        'href' => $page->toString(),
        'variant' => 'neutral',
        'attributes' => (new Htmx())->get($dialog)->target('#bakers-overlay')->select('dialog')->swap('innerHTML')
          ->getAttributes(),
      ],
    ];
  }

  /**
   * Typed form entity for this review comment form.
   */
  private function reviewComment(): BbCommentInterface {
    $comment = $this->entity;
    assert($comment instanceof BbCommentInterface);
    return $comment;
  }

  /**
   * Applies a still-allowed review transition onto the form entity.
   */
  private function applyAllowed(string $id): void {
    $item = $this->reviewComment()->get('review_state')->first();
    if ($item instanceof StateItemInterface && $item->isTransitionAllowed($id)) {
      $item->applyTransitionById($id);
    }
  }

  /**
   * Back to the opening screen, or to the review's ticket without one.
   *
   * A dialog save answers with HX-Location, which closes the dialog and
   * reloads the ticket with the new review state.
   */
  protected function returnUrl(): Url {
    if ($this->getRequest()->query->has(static::RETURN_PARAMETER)) {
      return $this->destinationUrl();
    }
    $ticket = $this->reviewComment()->get('ticket_id')->entity;
    return $ticket instanceof BbTicketInterface ? $ticket->toUrl() : Url::fromRoute('<front>');
  }

  /**
   * Binds the route ticket onto a new review.
   */
  private function bindTicket(): void {
    $comment = $this->reviewComment();
    if (!$comment->isNew()) {
      return;
    }
    $ticket = $this->getRouteMatch()->getParameter('bb_ticket');
    if ($ticket instanceof BbTicketInterface) {
      $comment->set('ticket_id', $ticket->id());
    }
  }

  /**
   * Whether the current actor may still apply this transition.
   */
  private function transitionAllowed(string $id): bool {
    $item = $this->reviewComment()->get('review_state')->first();
    return $item instanceof StateItemInterface && $item->isTransitionAllowed($id);
  }

}
