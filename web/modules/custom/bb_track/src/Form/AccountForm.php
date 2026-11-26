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
 * Each row is one link to its account's detail, which hosts Edit, Make
 * default and Archive (AccountActionsForm); the page header's New opens
 * AccountEditForm (the `bb_track.create.account` local action). Tickets
 * are linked on the ticket, so a row only names them.
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
    foreach ($active as $billing_account) {
      $default = (bool) $billing_account->get('is_default')->value;
      $cells = [
        'name' => $this->nameCell($billing_account),
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
      ];
      if ($default) {
        $cells['default'] = [
          'kind' => 'badge',
          'label' => (string) $this->t('Default'),
          'tone' => 'running',
          'dot' => TRUE,
        ];
      }
      $items[] = ['cells' => $cells];
    }
    $archived_items = [];
    foreach ($archived as $billing_account) {
      $archived_items[] = [
        'cells' => [
          'name' => $this->nameCell($billing_account),
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
   * The row's one link: the account's name, to its detail.
   *
   * @return array<string, mixed>
   *   A `link` cell.
   */
  private function nameCell(Account $billing_account): array {
    return [
      'kind' => 'link',
      'value' => (string) $billing_account->label(),
      'url' => $billing_account->toUrl()->toString(),
    ];
  }

  /**
   * Wraps the rows in the zone.
   *
   * @param array<string, mixed> $form
   *   The built form.
   *
   * @return array<string, mixed>
   *   The form with the zone.
   */
  public static function renderZone(array $form): array {
    $zone = $form['#bb_zone'];
    $items = $zone['items'];
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
            'right' => ['default'],
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
    // Nothing to submit: the actions are on each account's detail.
  }

}
