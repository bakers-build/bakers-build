<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\WorkAssignments;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The ticket inspector's Billing row: pick a linkable account or Inherit.
 *
 * Offered to project editors only (TicketBillingSource), posted to its own
 * route (TicketAccountAccess); the write itself re-checks project update
 * access in WorkAssignments::linkTicket(). The
 * linkable accounts are the project's active ones except the default,
 * which is what Inherit falls back to. An explicit Save, like the
 * Properties rows; a pick made from a stale view writes nothing.
 *
 * @SuppressWarnings("PHPMD.UnusedFormalParameter")
 */
final class TicketAccountForm extends FormBase {

  /**
   * Constructs the native form with serializable application services.
   */
  public function __construct(
    protected WorkAssignments $assignments,
    protected EntityTypeManagerInterface $entityTypes,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_track.assignments'),
      $container->get('entity_type.manager'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_ticket_account';
  }

  /**
   * The read-only Billing row: the applying account and where it comes from.
   *
   * @return array<string, mixed>
   *   A `plain` `list` in a zone, like the Properties rows.
   */
  public static function row(
    BbTicketInterface $ticket,
    WorkAssignments $assignments,
    EntityStorageInterface $ticket_storage,
    ?array $value = NULL,
  ): array {
    [$account, $source] = $assignments->resolution(
      (int) $ticket->get('project_id')->target_id,
      (int) $ticket->id(),
    );
    $items = [
      [
        'cells' => [
          'label' => ['kind' => 'text', 'value' => (string) new TranslatableMarkup('Billing'), 'emphasis' => 'faint'],
          'value' => $value ?? ($account instanceof Account
            ? ['kind' => 'text', 'value' => (string) $account->label()]
            : [
              'kind' => 'text',
              'value' => (string) new TranslatableMarkup('No billing account configured'),
              'emphasis' => 'faint',
            ]),
        ],
      ],
    ];
    // Its own row: beside the picker the narrow rail would wrap it.
    if ($account instanceof Account) {
      $items[] = [
        'cells' => [
          'label' => ['kind' => 'text', 'value' => (string) new TranslatableMarkup('Source'), 'emphasis' => 'faint'],
          'value' => [
            'kind' => 'badge',
            'label' => self::origin($ticket, $source, $ticket_storage),
            'tone' => 'neutral',
          ],
        ],
      ];
    }
    // The zone the Properties block wraps its rows in, so the label column
    // lines up with theirs.
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'columns' => 1],
      '#slots' => [
        'content' => [
          '#type' => 'component',
          '#component' => 'bb_theme:list',
          '#props' => ['layout' => 'plain', 'items' => $items],
        ],
      ],
    ];
  }

  /**
   * The origin badge: linked, from an ancestor, or the project default.
   */
  private static function origin(
    BbTicketInterface $ticket,
    ?int $source,
    EntityStorageInterface $ticket_storage,
  ): string {
    if ($source === NULL) {
      return (string) new TranslatableMarkup('project default');
    }
    if ($source === (int) $ticket->id()) {
      return (string) new TranslatableMarkup('linked');
    }
    $ancestor = $ticket_storage->load($source);
    return (string) new TranslatableMarkup('from @ticket', [
      '@ticket' => $ancestor instanceof BbTicketInterface ? $ancestor->getIdentifier() : '#' . $source,
    ]);
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?BbTicketInterface $bb_ticket = NULL): array {
    $ticket = $bb_ticket;
    $project_id = (int) $ticket->get('project_id')->target_id;
    $linked = $this->assignments->linkedAccount($project_id, (int) $ticket->id());
    [$resolved] = $this->assignments->resolution($project_id, (int) $ticket->id());
    $form_state->set('ticket_id', (int) $ticket->id());
    $form['#cache']['max-age'] = 0;
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['#action'] = Url::fromRoute('bb_track.ticket_account', $ticket->toUrl()->getRouteParameters())->toString();
    // #default_value, not #value: the posted link the page showed must win.
    $form['shown'] = ['#type' => 'hidden', '#default_value' => (string) (int) $linked?->id()];
    $options = [];
    foreach ($this->assignments->activeAccounts($project_id) as $id => $account) {
      if (!$account->get('is_default')->value) {
        $options[(string) $id] = [
          'value' => (string) $id,
          'label' => (string) $account->label(),
          'description' => (string) $account->get('external_id')->value,
          'selected' => $linked?->id() === $account->id(),
        ];
      }
    }
    $form['billing_account'] = [
      '#type' => 'bb_picker_value',
      '#title' => $this->t('Billing account'),
      '#title_display' => 'invisible',
      '#default_value' => $linked ? [(string) $linked->id()] : [],
      '#picker_options' => array_map(
        static fn (array $option) => ['label' => $option['label'], 'description' => $option['description']],
        $options,
      ),
      '#printed' => TRUE,
    ];
    $form['row'] = self::row($ticket, $this->assignments, $this->entityTypes->getStorage('bb_ticket'), [
      'kind' => 'picker',
      'name' => 'billing_account',
      'picker_id' => 'ticket-billing-account',
      'label' => (string) $this->t('Billing account'),
      'multiple' => FALSE,
      'value_labels' => [(string) ($linked?->label() ?? $resolved?->label() ?? $this->t('Inherit'))],
      'options' => array_values($options),
      'clearable' => TRUE,
      'clear_label' => (string) $this->t('Inherit'),
      'open' => FALSE,
    ]);
    $form['row']['#attached']['library'][] = 'core/components.bb_theme--option_picker';
    // The picker's panel opens with JavaScript only; without it this native
    // choice is the control, and core's js-hide hides it with JavaScript.
    // Not <noscript>: the htmx-swapped ticket page would parse it live.
    $form['native'] = [
      '#type' => 'container',
      '#attributes' => ['class' => ['js-hide']],
      'billing_account_nojs' => [
        '#type' => 'select',
        '#title' => $this->t('Billing account'),
        '#options' => ['' => $this->t('Inherit')] + array_map(
          static fn (array $option) => $option['label'],
          $options,
        ),
        '#default_value' => $linked ? (string) $linked->id() : '',
      ],
    ];
    $form['actions'] = [
      '#type' => 'actions',
      'submit' => [
        '#type' => 'submit',
        '#value' => $this->t('Save billing account'),
        '#bb_variant' => 'ghost',
        '#theme_wrappers' => ['input__submit__bb_button'],
      ],
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    $picked = self::picked($form_state);
    $ticket_id = (int) $form_state->get('ticket_id');
    try {
      $this->assignments->linkTicket(
        $ticket_id,
        $picked === '' ? NULL : (int) $picked,
        (int) $form_state->getValue('shown'),
      );
      $this->messenger()->addStatus($picked === ''
        ? $this->t('This ticket inherits its billing account again.')
        : $this->t('Billing account linked to this ticket.'));
    }
    catch (\DomainException $error) {
      $this->messenger()->addError($error->getMessage());
    }
    // A busy account lock, or a database error: logged, never shown raw.
    catch (\Throwable $error) {
      $this->logger('bb_track')->error('Billing account link failed: @message', ['@message' => $error->getMessage()]);
      $this->messenger()->addError($this->t('The billing account could not be saved. Refresh and retry.'));
    }
    $ticket = $this->entityTypes->getStorage('bb_ticket')->load($ticket_id);
    if ($ticket instanceof BbTicketInterface) {
      $form_state->setRedirectUrl($ticket->toUrl());
    }
  }

  /**
   * The operator's choice: an account id, or '' for Inherit.
   *
   * Both controls post: the picker's radios and the native select. The one
   * that differs from what the form showed is the choice; the picker wins a
   * tie, the native select counts only without it.
   */
  private static function picked(FormStateInterface $form_state): string {
    $shown = (string) $form_state->getValue('shown');
    $shown = $shown === '0' ? '' : $shown;
    $value = $form_state->getValue('billing_account');
    $picked = is_array($value) ? (string) (reset($value) ?: '') : (string) $value;
    $native = $form_state->getUserInput()['billing_account_nojs'] ?? NULL;
    return $picked === $shown && is_string($native) ? $native : $picked;
  }

}
