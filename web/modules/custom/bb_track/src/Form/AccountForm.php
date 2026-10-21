<?php

declare(strict_types=1);

namespace Drupal\bb_track\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Security\TrustedCallbackInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\WorkAssignments;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The project's billing face: its accounts as rows, one of them the default.
 *
 * Make default and Archive are this form's submits, rendered into their
 * row; Edit opens AccountEditForm, and so does the page header's New
 * (BillingAccountCreateActionSource). Tickets are linked on the ticket,
 * so a row only names them. The default and ticket links exclude each
 * other: the default offers no Archive, a linked account no Make default.
 *
 * @SuppressWarnings("PHPMD.UnusedFormalParameter")
 */
final class AccountForm extends FormBase implements TrustedCallbackInterface {

  /**
   * Constructs the native form with serializable application services.
   */
  public function __construct(
    protected WorkAssignments $assignments,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container): static {
    return new static(
      $container->get('bb_track.assignments'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'bb_track_account';
  }

  /**
   * {@inheritdoc}
   */
  public static function trustedCallbacks(): array {
    return ['renderZone'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, ?BbProjectInterface $bb_project = NULL): array {
    $form_state->set('project', $bb_project);
    $form['#attributes']['data-hx-boost'] = 'false';
    $form['#cache']['max-age'] = 0;
    $form['messages'] = ['#type' => 'status_messages'];
    $accounts = $this->assignments->accounts((int) $bb_project->id());
    $active = array_filter($accounts, static fn (Account $account) => (bool) $account->get('active')->value);
    $archived = array_diff_key($accounts, $active);
    uasort($active, static function (Account $a, Account $b): int {
      return [(int) !$a->get('is_default')->value, $a->label()]
        <=> [(int) !$b->get('is_default')->value, $b->label()];
    });

    $items = [];
    $form['controls'] = ['#tree' => FALSE];
    foreach ($active as $id => $billing_account) {
      $default = (bool) $billing_account->get('is_default')->value;
      $tickets = WorkAssignments::linkedTickets($billing_account);
      $cells = [
        'name' => [
          'kind' => 'text',
          'value' => (string) $billing_account->label(),
          'emphasis' => 'strong',
        ],
        'type' => [
          'kind' => 'text',
          'value' => (string) $billing_account->get('external_id')->value,
          'emphasis' => 'faint',
        ],
        'tickets' => [
          'kind' => 'text',
          'value' => (string) $this->ticketsLine($billing_account, $default),
          'emphasis' => 'faint',
        ],
        'edit' => ['kind' => 'rendered'],
      ];
      $controls = [
        'edit' => AccountEditForm::trigger($bb_project, $billing_account, (string) $this->t('Edit'), 'ghost', FALSE),
      ];
      if ($default) {
        $cells['default'] = [
          'kind' => 'badge',
          'label' => (string) $this->t('Default'),
          'tone' => 'running',
          'dot' => TRUE,
        ];
      }
      if (!$default && $tickets === []) {
        $cells['make_default'] = ['kind' => 'rendered'];
        $controls['make_default'] = $this->rowSubmit('make_default', $id, $this->t('Make default'), '::makeDefault');
      }
      if (!$default) {
        $cells['archive'] = ['kind' => 'rendered'];
        $controls['archive'] = $this->rowSubmit('archive', $id, $this->t('Archive'), '::archive');
      }
      $items[] = ['cells' => $cells];
      $form['controls'][$id] = $controls;
    }
    $archived_items = [];
    foreach ($archived as $billing_account) {
      $archived_items[] = [
        'cells' => [
          'name' => ['kind' => 'text', 'value' => (string) $billing_account->label()],
          'type' => [
            'kind' => 'text',
            'value' => (string) $billing_account->get('external_id')->value,
            'emphasis' => 'faint',
          ],
          'state' => ['kind' => 'badge', 'label' => (string) $this->t('Archived'), 'tone' => 'offline'],
        ],
      ];
    }

    $form['#pre_render'] = [[self::class, 'renderZone']];
    $form['#bb_zone'] = [
      'items' => $items,
      'empty' => (string) $this->t('This project has no active billing account. Create one to start booking time against it.'),
      'archived' => $archived_items,
      'archived_label' => (string) $this->t('Archived accounts (@count)', ['@count' => count($archived_items)]),
    ];
    return $form;
  }

  /**
   * One row's submit, rendered into its row by renderZone().
   *
   * @return array<string, mixed>
   *   A Form API submit.
   */
  private function rowSubmit(string $action, int $id, TranslatableMarkup $label, string $handler): array {
    return [
      '#type' => 'submit',
      '#name' => $action . '_' . $id,
      // Own parents, so every row's control gets its own id and value.
      '#parents' => [$action . '_' . $id],
      '#value' => $label,
      '#bb_account_id' => $id,
      '#bb_variant' => 'ghost',
      '#theme_wrappers' => ['input__submit__bb_button'],
      '#limit_validation_errors' => [],
      '#submit' => [$handler],
    ];
  }

  /**
   * Moves the row controls into their rows and wraps everything in the zone.
   *
   * Runs after Form API processed the controls, so they render with their
   * names; their markup becomes the `rendered` cells of their row.
   *
   * @param array<string, mixed> $form
   *   The built form.
   *
   * @return array<string, mixed>
   *   The form with the zone.
   */
  public static function renderZone(array $form): array {
    $renderer = \Drupal::service('renderer');
    $zone = $form['#bb_zone'];
    $items = $zone['items'];
    $index = 0;
    foreach (array_keys($form['controls']) as $id) {
      if (!is_int($id)) {
        continue;
      }
      foreach ($form['controls'][$id] as $key => $control) {
        if (is_string($key) && $key[0] !== '#') {
          $items[$index]['cells'][$key]['markup'] = $renderer->render($control);
        }
      }
      $index++;
    }
    unset($form['controls']);
    $content = [
      'list' => [
        '#type' => 'component',
        '#component' => 'bb_theme:list',
        '#props' => [
          'layout' => 'cards',
          'spacing' => 'comfortable',
          'pattern' => [
            'headline' => ['name'],
            'meta' => ['type', 'tickets'],
            'right' => ['default', 'make_default', 'edit', 'archive'],
          ],
          'items' => $items,
        ],
        '#slots' => ['empty' => ['#markup' => $zone['empty']]],
      ],
    ];
    if ($zone['archived'] !== []) {
      $content['archived'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:collapsible',
        '#props' => ['open' => FALSE],
        '#slots' => [
          'label' => ['#markup' => $zone['archived_label']],
          'content' => [
            '#type' => 'component',
            '#component' => 'bb_theme:list',
            '#props' => [
              'layout' => 'cards',
              'spacing' => 'comfortable',
              'pattern' => ['headline' => ['name'], 'meta' => ['type'], 'right' => ['state']],
              'items' => $zone['archived'],
            ],
          ],
        ],
      ];
    }
    $form['zone'] = [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#weight' => 10,
      // No heading or description: the page header says what this holds.
      '#props' => ['gap' => 'lg'],
      '#slots' => [
        'content' => $content,
      ],
    ];
    return $form;
  }

  /**
   * The meta line naming what the account is booked for.
   */
  private function ticketsLine(Account $billing_account, bool $default): TranslatableMarkup {
    if ($default) {
      return $this->t('Booked for every ticket without its own account');
    }
    $identifiers = [];
    foreach ($billing_account->get('tickets')->referencedEntities() as $ticket) {
      if ($ticket instanceof BbTicketInterface) {
        $identifiers[] = $ticket->getIdentifier();
      }
    }
    return $identifiers === []
      ? $this->t('No linked tickets')
      : $this->t('Linked to @tickets', ['@tickets' => implode(', ', $identifiers)]);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // Unreachable: every row submit declares its own #submit callback.
  }

  /**
   * Makes the pressed row's account the project default.
   */
  public function makeDefault(array &$form, FormStateInterface $form_state): void {
    $id = self::pressedId($form_state);
    if ($id === NULL) {
      $this->messenger()->addError($this->t('This billing account changed elsewhere. Reload the page and try again.'));
      return;
    }
    $this->persist($form_state, fn () => $this->assignments->makeDefault($this->projectId($form_state), $id), $this->t('Default billing account changed. Existing bookings keep their account.'));
  }

  /**
   * Archives the pressed row's account; old bookings keep their id.
   */
  public function archive(array &$form, FormStateInterface $form_state): void {
    $id = self::pressedId($form_state);
    $project_id = $this->projectId($form_state);
    $billing_account = $id === NULL ? NULL : $this->assignments->activeAccounts($project_id)[$id] ?? NULL;
    if (!$billing_account instanceof Account) {
      $this->messenger()->addError($this->t('This billing account changed elsewhere. Reload the page and try again.'));
      return;
    }
    $this->persist($form_state, fn () => $this->assignments->saveAccount($project_id, [
      'name' => (string) $billing_account->label(),
      'external_id' => (string) $billing_account->get('external_id')->value,
      'active' => FALSE,
    ], $id), $this->t('Billing account archived. Existing bookings keep their account; its tickets use the inherited account.'));
  }

  /**
   * The pressed row's account id, or NULL when its control was not posted.
   *
   * A control gone since the page loaded matches nothing, and Form API then
   * takes the first remaining button: another row's.
   */
  private static function pressedId(FormStateInterface $form_state): ?int {
    $trigger = $form_state->getTriggeringElement();
    return array_key_exists($trigger['#name'], $form_state->getUserInput())
      ? (int) $trigger['#bb_account_id']
      : NULL;
  }

  /**
   * Runs a billing-account write, mapping its domain errors to a message.
   */
  private function persist(FormStateInterface $form_state, callable $write, TranslatableMarkup $success): void {
    try {
      $write();
      $this->messenger()->addStatus($success);
    }
    catch (\InvalidArgumentException | \DomainException $error) {
      $this->messenger()->addError($error->getMessage());
    }
    catch (\Throwable $error) {
      $this->logger('bb_track')->error('Billing account write failed: @message', ['@message' => $error->getMessage()]);
      $this->messenger()->addError($this->t('The billing account could not be saved. Refresh and retry.'));
    }
    $project = $form_state->get('project');
    assert($project instanceof BbProjectInterface);
    $form_state->setRedirect('bb_track.account', ['bb_project' => $project->uuid()]);
  }

  /**
   * The route's project id, as stored by the build step.
   */
  private function projectId(FormStateInterface $form_state): int {
    $project = $form_state->get('project');
    assert($project instanceof BbProjectInterface);
    return (int) $project->id();
  }

}
