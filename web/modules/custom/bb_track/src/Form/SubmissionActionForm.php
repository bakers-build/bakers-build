<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\bb_track\Entity\Submission;
use Drupal\bb_track\Proposals;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Discard for an AI proposal, Submit for a draft; own submissions only.
 */
final class SubmissionActionForm extends FormBase {

  /**
   * Discards proposals.
   */
  protected Proposals $proposals;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = new static();
    $form->proposals = $container->get('bb_track.proposals');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_submission_actions';
  }

  /**
   * {@inheritdoc}
   *
   * @param array<string, mixed> $form
   *   The form.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   Form state.
   * @param list<\Drupal\bb_track\Entity\Submission> $submissions
   *   Submissions the page offers actions for.
   */
  public function buildForm(array $form, FormStateInterface $form_state, array $submissions = []): array {
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['#attributes']['autocomplete'] = 'off';
    $form['actions'] = ['#type' => 'actions', '#theme_wrappers' => ['container__form_actions']];
    $own = [];
    foreach ($submissions as $submission) {
      if (!$submission instanceof Submission || (int) $submission->getOwnerId() !== (int) $this->currentUser()->id()) {
        continue;
      }
      $own[(int) $submission->id()] = $submission;
      $state = $submission->get('state')->value;
      if ($state === 'proposed') {
        $form['actions']['discard_' . $submission->id()] = $this->button('discard_' . $submission->id(), (string) $this->t('Discard proposal'));
        $form['actions']['discard_' . $submission->id()]['#bb_variant'] = 'danger';
      }
      elseif ($state === 'draft') {
        $form['actions']['submit_' . $submission->id()] = $this->button('submit_' . $submission->id(), (string) $this->t('Submit'));
      }
    }
    $form_state->set('submissions', array_keys($own));
    $form['#cache']['max-age'] = 0;
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $name = (string) ($form_state->getTriggeringElement()['#name'] ?? '');
    if (!preg_match('/^(discard|submit)_(\d+)$/', $name, $match) || !in_array((int) $match[2], $form_state->get('submissions') ?? [], TRUE)) {
      return;
    }
    $submission = Submission::load($match[2]);
    if (!$submission instanceof Submission) {
      return;
    }
    try {
      if ($match[1] === 'discard') {
        $this->discard($submission);
        return;
      }
      $submission->set('state', 'submitted')->save();
      $this->messenger()->addStatus($this->t('Week submitted.'));
    }
    catch (\RuntimeException | \DomainException $error) {
      $this->messenger()->addError($error->getMessage());
    }
  }

  /**
   * Discards a proposal and reports what actually happened.
   */
  private function discard(Submission $submission): void {
    $this->proposals->discard($submission);
    $state = Submission::load($submission->id())?->get('state')->value;
    if ($state === 'discarded') {
      $this->messenger()->addStatus($this->t('Proposal discarded. No time was recorded.'));
      return;
    }
    $this->messenger()->addError($this->t('This proposal was already saved. Nothing was discarded.'));
  }

  /**
   * A submit button with its own name.
   *
   * @return array<string, mixed>
   *   The button.
   */
  private function button(string $name, string $label): array {
    return [
      '#type' => 'submit',
      '#name' => $name,
      '#value' => $label,
      '#theme_wrappers' => ['input__submit__bb_button'],
    ];
  }

}
