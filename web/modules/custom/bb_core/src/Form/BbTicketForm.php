<?php

declare(strict_types=1);

namespace Drupal\bb_core\Form;

use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbTicketInterface;

/**
 * Ticket entity form: meta header (status + labels) plus accordion panels.
 *
 * As the `settings` operation it is the ticket's in-app Settings screen: the
 * settings form display's few fields, a Delete entry and the way back to the
 * ticket. It offers no workflow transition: AI agents drive the workflow,
 * and the detail page owns the only human interventions.
 */
final class BbTicketForm extends BbContentEntityFormBase {

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);
    $ticket = $this->getEntity();
    assert($ticket instanceof BbTicketInterface);

    // `identifier` has no author either: preSave freezes it from the project's
    // allocated number (BbTicket::allocateNumber), and the access handler
    // denies the field's `edit` operation for every actor — which is what
    // EntityFormDisplay::buildForm() turns into `#access => FALSE`, removing
    // the widget from both forms. On a new ticket that is right (nothing to
    // show, nobody to author it); on an existing one the identifier is the
    // ticket's primary human handle, so restore it read-only.
    if (isset($form['identifier'])) {
      $exists = !$ticket->isNew();
      // Hidden until the ticket exists, then read-only once shown.
      $form['identifier']['#access'] = $exists;
      $form['identifier']['#disabled'] = $exists;
    }

    // `closed` / `closed_date` are set by BbTicket::preSave() on any save of
    // a terminal, unclosed ticket, and are never edited by hand. Only surface
    // them once set, read-only.
    $closed = $ticket->isClosed();
    foreach (['closed', 'closed_date'] as $field) {
      if (!isset($form[$field])) {
        continue;
      }
      // Hidden until the ticket is closed, then read-only once shown.
      $form[$field][$closed ? '#disabled' : '#access'] = $closed ? TRUE : FALSE;
    }

    if ($this->getOperation() === 'settings') {
      $form['back'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'label' => (string) $this->t('Back to ticket'),
          'href' => $ticket->toUrl()->toString(),
          'variant' => 'ghost',
        ],
        '#weight' => -900,
      ];
      return $form;
    }

    if (!$ticket->isNew() && !$ticket->get('comments')->isEmpty()) {
      $form['bb_comments'] = [
        '#type' => 'details',
        '#title' => $this->t('Comments'),
        '#open' => TRUE,
        '#weight' => 50,
        'list' => $ticket->get('comments')->view([
          'type' => 'entity_reference_entity_view',
          'label' => 'hidden',
          'settings' => ['view_mode' => 'default', 'link' => FALSE],
        ]),
      ];
    }
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  protected function actions(array $form, FormStateInterface $form_state): array {
    $actions = parent::actions($form, $form_state);
    $ticket = $this->getEntity();
    assert($ticket instanceof BbTicketInterface);
    if ($this->getOperation() === 'settings' && !$ticket->isNew()) {
      // A closed ticket is frozen; its Settings are read-only unless an
      // administrator may still correct `state` on a non-terminal row.
      $actions['submit']['#access'] = !$ticket->isClosed()
        || $ticket->get('state')->access('edit');
    }
    return $actions;
  }

  /**
   * {@inheritdoc}
   */
  protected static function metaGroups(): array {
    return [
      'meta' => [
        'label' => new TranslatableMarkup('Status'),
        'open' => TRUE,
        'weight' => -10,
        // Both time fields are plain integers in SECONDS here on purpose: the
        // human grammar lives in `bakers ui`, and duplicating a duration parser
        // into PHP to serve the rare admin fallback would be cost without a
        // beneficiary.
        'fields' => ['identifier', 'priority', 'time_estimate', 'time_spent', 'labels'],
      ],
      // Key must not equal a field machine name (`state` is a field) — the base
      // would clobber the field element with the group container.
      'lifecycle' => [
        'label' => new TranslatableMarkup('State'),
        'open' => TRUE,
        'weight' => -9,
        'fields' => ['state', 'workflow', 'closed', 'closed_date'],
      ],
      'people' => [
        'label' => new TranslatableMarkup('People & Project'),
        'open' => TRUE,
        'weight' => 0,
        'fields' => ['project_id', 'assignee_user_id', 'reviewers'],
      ],
      'relations' => [
        'label' => new TranslatableMarkup('Relations'),
        'open' => FALSE,
        'weight' => 1,
        'fields' => ['parent_id', 'blocked_by', 'links'],
      ],
      'source' => [
        'label' => new TranslatableMarkup('Source'),
        'open' => FALSE,
        'weight' => 2,
        'fields' => ['origin', 'created', 'changed'],
      ],
    ];
  }

}
