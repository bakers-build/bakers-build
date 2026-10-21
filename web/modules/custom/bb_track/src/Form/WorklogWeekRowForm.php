<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Component\Utility\UrlHelper;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\bb_track\WorkAssignments;
use Drupal\bb_track\WorkTargetOptions;
use Drupal\island\Form\WrappedDialogFormTrait;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Chooses a project/ticket row for the week grid, in the dialog.
 *
 * The chosen row travels back to the week as `rows=<project>:<ticket>`; the
 * grid shows it with empty cells until a duration is saved into it.
 */
final class WorklogWeekRowForm extends FormBase {

  use WrappedDialogFormTrait;

  /**
   * Project and ticket candidates.
   */
  protected WorkTargetOptions $targets;

  /**
   * Billing-account resolution.
   */
  protected WorkAssignments $assignments;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    $form = new static();
    $form->islandResponder = $container->get('island.responder');
    $form->targets = $container->get('bb_track.target_options');
    $form->assignments = $container->get('bb_track.assignments');
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_week_row_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['#attributes']['autocomplete'] = 'off';
    $form['messages'] = ['#type' => 'status_messages', '#weight' => -1000];
    $form['project'] = WorklogFormLayout::picker((string) $this->t('Project'), 'project', $this->targets->projects(), []) + [
      // A pick shows that project's tickets.
      '#picker_attributes' => [
        'x-on:change.self' => "\$el.closest('form')?.querySelector('[data-bakers-row-tickets]')?.click()",
      ],
    ];
    $project = $this->chosenProject($form_state);
    $tickets = $project === NULL ? [] : $this->targets->tickets($project);
    $form['ticket'] = WorklogFormLayout::picker((string) $this->t('Ticket'), 'ticket', $tickets, [], (string) $this->t('No ticket'));
    if ($project !== NULL) {
      $form['project']['#default_value'] = [(string) $project];
      $form['ticket']['#picker_search_url'] = Url::fromRoute('bb_track.worklog.ticket_options', [], ['query' => ['project' => $project]])->toString();
      // The row is a project/ticket key; each cell saved into it books the
      // account resolved then. Shown here so the employee knows beforehand.
      $ticket = $this->pickedId($form_state->getUserInput()['ticket'] ?? NULL);
      try {
        $form['account'] = [
          '#type' => 'item',
          '#markup' => $this->t('Billing account: @name', [
            '@name' => $this->assignments->assignment($project, $ticket !== NULL && $this->targets->ticketOf($ticket, $project) !== NULL ? $ticket : NULL)['name'],
          ]),
        ];
      }
      catch (\DomainException $error) {
        $form['account'] = ['#type' => 'item', '#markup' => $error->getMessage()];
      }
    }
    // Inside the form, not the actions row the dialog lifts out of it, so a
    // project pick can click it. Only visible without JavaScript.
    $form['fallback'] = [
      '#type' => 'container',
      '#attributes' => ['class' => ['js-hide']],
      'show_tickets' => [
        '#type' => 'submit',
        '#value' => $this->t('Show tickets'),
        '#name' => 'show_tickets',
        '#submit' => ['::showTickets'],
        '#limit_validation_errors' => [],
        '#attributes' => ['data-bakers-row-tickets' => 'data-bakers-row-tickets'],
      ],
    ];
    $form['actions'] = [
      '#type' => 'actions',
      'submit' => ['#type' => 'submit', '#value' => $this->t('Add row')],
      'cancel' => [
        '#type' => 'link',
        '#title' => $this->t('Cancel'),
        '#url' => $this->returnUrl(),
        '#attributes' => ['data-dialog-cancel' => 'data-dialog-cancel'],
      ],
    ];
    $this->attachDialogHtmx($form);
    return $form;
  }

  /**
   * Rebuilds the dialog so the ticket picker follows the chosen project.
   *
   * @SuppressWarnings("PHPMD.UnusedFormalParameter")
   */
  public function showTickets(array &$form, FormStateInterface $form_state): void {
    $form_state->setRebuild();
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    $project = $this->pickedId($form_state->getValue('project'));
    $ticket = $this->pickedId($form_state->getValue('ticket'));
    if ($project === NULL || !array_key_exists((string) $project, $this->targets->projects())) {
      $form_state->setErrorByName('project', $this->t('Select a project you can record time against.'));
      return;
    }
    if ($ticket !== NULL && $this->targets->ticketOf($ticket, $project) === NULL) {
      $form_state->setErrorByName('ticket', $this->t('Select a ticket of this project, or No ticket.'));
      return;
    }
    try {
      $this->assignments->assignment($project, $ticket);
    }
    catch (\DomainException $error) {
      $form_state->setErrorByName('project', $error->getMessage());
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $row = $this->pickedId($form_state->getValue('project')) . ':' . ($this->pickedId($form_state->getValue('ticket')) ?? 0);
    // The week is the destination; the chosen row rides along in its query.
    $request = $this->getRequest();
    $parsed = UrlHelper::parse((string) $request->query->get('destination', ''));
    if (!str_starts_with($parsed['path'], '/')) {
      $this->respondAtReturnUrl($form_state);
      return;
    }
    $rows = array_filter(explode(',', (string) ($parsed['query']['rows'] ?? '')));
    $parsed['query']['rows'] = implode(',', array_unique([...$rows, $row]));
    $request->query->set('destination', $parsed['path'] . '?' . UrlHelper::buildQuery($parsed['query']));
    $this->respondAtReturnUrl($form_state);
  }

  /**
   * The project picked so far, from input on a rebuild.
   */
  private function chosenProject(FormStateInterface $form_state): ?int {
    $project = $this->pickedId($form_state->getUserInput()['project'] ?? NULL);
    return $project !== NULL && array_key_exists((string) $project, $this->targets->projects()) ? $project : NULL;
  }

  /**
   * A positive id from a picker value.
   */
  private function pickedId(mixed $value): ?int {
    $first = ((array) $value)[0] ?? NULL;
    return is_scalar($first) && ctype_digit((string) $first) && (int) $first > 0 ? (int) $first : NULL;
  }

}
