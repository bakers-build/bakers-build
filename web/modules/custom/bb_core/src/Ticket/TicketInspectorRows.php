<?php

declare(strict_types=1);

namespace Drupal\bb_core\Ticket;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Url;
use Drupal\bb_core\Claim\TicketStallReason;
use Drupal\bb_core\Entity\BbTicketInterface;
use Drupal\bb_core\EnvVars;
use Drupal\bb_core\Inspector\InspectorRows;
use Drupal\bb_core\Run\RunSummary;
use Drupal\bb_core\Run\TicketRunSummary;
use Drupal\bb_core\Time\BbDate;

/**
 * Formats read-only ticket properties for the inspector list.
 */
final class TicketInspectorRows extends InspectorRows {

  /**
   * Inspector fields in display order, keyed by field name.
   */
  public const array FIELDS = [
    'stall_reason' => 'Stall',
    'assignee_user_id' => 'Assignee',
    'reviewers' => 'Reviewers',
    'conductor_id' => 'Conductor',
    'priority' => 'Priority',
    'ticket_type' => 'Type',
    'recipe' => 'Recipe',
    'labels' => 'Labels',
    'owner_user_id' => 'Created by',
    'runs' => 'Runs',
    'time_estimate' => 'Estimate',
    'time_spent' => 'Spent',
    'branch_name' => 'Branch',
    'base_branch' => 'Base branch',
    'environments' => 'Environments',
    'deployments' => 'Deployed to',
    'env_vars' => 'Env vars',
    'parent_id' => 'Parent',
    'sub_tickets' => 'Sub-tickets',
    'blocked_by' => 'Blocked by',
    'referenced_tickets' => 'Referenced',
  ];

  public function __construct(
    private readonly BbDate $date,
    private readonly TicketRunSummary $runSummary,
  ) {}

  /**
   * Ticket-relation fields rendered as linked chips.
   */
  private const array RELATIONS = [
    'parent_id',
    'sub_tickets',
    'blocked_by',
    'referenced_tickets',
  ];

  /**
   * Builds the rail's `items` array.
   *
   * @return array<string, array<string, mixed>>
   *   Twenty-one `list` items, in the order the scene fixes.
   */
  public function build(BbTicketInterface $ticket): array {
    return $this->buildRows($ticket, self::FIELDS);
  }

  /**
   * {@inheritdoc}
   */
  protected function fieldRow(FieldableEntityInterface $entity, string $field, string $label): array {
    assert($entity instanceof BbTicketInterface);
    if ($field === 'env_vars') {
      if (!$entity->get('effective_env_vars')->access('view')) {
        return $this->row($label, $this->dash());
      }
      return $this->envVars($entity);
    }
    if ($field === 'deployments') {
      return $this->deploymentsRow($label, $entity);
    }
    if ($field === 'runs') {
      return $this->runsRow($label, $entity);
    }
    if (in_array($field, self::RELATIONS, TRUE)) {
      return $this->relationRow($label, $entity, $field);
    }
    $value = match ($field) {
      'priority' => $this->text($entity->getPriority() === NULL ? '' : 'P' . $entity->getPriority()),
      'time_estimate', 'time_spent' => $this->duration($entity, $field),
      'branch_name', 'base_branch' => $this->mono((string) $entity->get($field)->value),
      'stall_reason' => $this->stall($entity),
      default => $this->text($this->labelsOf($entity, $field)),
    };
    return $this->row($label, $value);
  }

  /**
   * The read-only blocks of the rail and the fields each one shows.
   */
  public const array GROUPS = [
    'effort' => ['time_estimate', 'time_spent'],
    'code' => ['branch_name', 'base_branch', 'environments', 'deployments', 'env_vars'],
    // Parent and Blocked by are editable properties, in the Properties block.
    'relations' => ['sub_tickets', 'referenced_tickets'],
  ];

  /**
   * The rail's first block: the Properties heading over its main rows.
   *
   * The inspector draws the divider between its blocks; inside a block the
   * rows carry no line of their own.
   *
   * @param array<string, array<string, mixed>> $rows
   *   The `list` items keyed by field, as build() returns them; editable
   *   fields may already carry picker cells.
   * @param string $heading
   *   The zone heading.
   *
   * @return array<string, mixed>
   *   The `zone` render array, carrying the runs summary's cacheability.
   */
  public function propertiesBlock(array $rows, string $heading = 'Properties'): array {
    $fields = [
      'stall_reason',
      'assignee_user_id',
      'reviewers',
      'conductor_id',
      'priority',
      'ticket_type',
      'recipe',
      'labels',
      'parent_id',
      'blocked_by',
      'owner_user_id',
      'runs',
    ];
    $items = [];
    foreach ($fields as $field) {
      if (!isset($rows[$field])) {
        continue;
      }
      if (in_array($field, ['stall_reason', 'runs'], TRUE) && $this->isEmpty($rows[$field])) {
        continue;
      }
      $items[$field] = $rows[$field];
    }
    unset($items['runs']['#cache']);
    $block = parent::propertiesBlock($items, $heading);
    CacheableMetadata::createFromRenderArray($rows['runs'] ?? [])->applyTo($block);
    return $block;
  }

  /**
   * One read-only block of the rail, without its empty rows.
   *
   * Effort stays open; Code and Relations are collapsed and summarised in
   * their label. A block with no filled row renders nothing.
   *
   * @param string $group
   *   A key of self::GROUPS.
   * @param array<string, array<string, mixed>> $rows
   *   The `list` items keyed by field, as build() returns them.
   * @param \Drupal\bb_core\Entity\BbTicketInterface|null $ticket
   *   The ticket the rows describe; Relations offers "Show in list →" for it.
   *
   * @return array<string, mixed>
   *   The `collapsible` render array, or an empty array.
   */
  public function groupBlock(string $group, array $rows, ?BbTicketInterface $ticket = NULL): array {
    $filled = array_values(array_filter(
      array_intersect_key($rows, array_flip(self::GROUPS[$group])),
      fn(array $row): bool => !$this->isEmpty($row),
    ));
    if ($filled === []) {
      return [];
    }
    $base = (string) ($rows['base_branch']['cells']['value']['value'] ?? '');
    $label = match ($group) {
      'effort' => 'Effort',
      'code' => $base === '' || $base === '—' ? 'Code' : 'Code · ' . $base,
      default => 'Relations · ' . array_sum(array_map(static fn(array $row): int => count($row['cells']) - 1, $filled)),
    };
    if ($group === 'relations' && $ticket !== NULL && $ticket->getProjectId() !== NULL && $this->hasReadableChip($rows['sub_tickets'] ?? [])) {
      $filled = $this->withShowInList($filled, $rows['sub_tickets'], $ticket);
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:collapsible',
      '#props' => ['open' => $group === 'effort'],
      '#slots' => [
        'label' => [
          '#type' => 'component',
          '#component' => 'bb_theme:text',
          '#props' => [
            'text' => $label,
            'as' => 'span',
            'size' => 'meta',
            'tone' => 'faint',
          ],
        ],
        'content' => $this->list($filled),
      ],
    ];
  }

  /**
   * Whether a relation row links at least one ticket the reader may open.
   *
   * @param array<string, mixed> $row
   *   The relation row; an unreadable ticket is a chip without a `url`.
   */
  private function hasReadableChip(array $row): bool {
    foreach ($row['cells'] ?? [] as $key => $cell) {
      if ($key !== 'label' && isset($cell['url'])) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Puts the "Show in list →" row right under the sub-tickets row.
   *
   * It opens the project's ticket list on this ticket's direct sub-tickets;
   * `closed=all` keeps the closed ones in. Only offered with a project and at
   * least one sub-ticket the reader may open, so no empty list.
   *
   * @param array<int, array<string, mixed>> $filled
   *   The block's rows.
   * @param array<string, mixed> $subTickets
   *   The sub-tickets row among them.
   * @param \Drupal\bb_core\Entity\BbTicketInterface $ticket
   *   The parent ticket.
   *
   * @return array<int, array<string, mixed>>
   *   The rows with the link row added.
   */
  private function withShowInList(array $filled, array $subTickets, BbTicketInterface $ticket): array {
    $url = Url::fromRoute(
      'view.tickets.project_tickets',
      ['bb_project' => $ticket->getProjectId()],
      ['query' => ['parent' => $ticket->getIdentifier(), 'closed' => 'all']],
    )->toString();
    $link = $this->row('', ['kind' => 'link', 'value' => 'Show in list →', 'url' => $url]);
    $position = array_search($subTickets, $filled, TRUE);
    array_splice($filled, $position === FALSE ? count($filled) : $position + 1, 0, [$link]);
    return $filled;
  }

  /**
   * The env-vars row: the keys, a withheld value, and where they came from.
   *
   * THE VALUE NEVER ENTERS THE RENDER ARRAY. Masking is structural rather than
   * cosmetic — the `masked` cell carries no `value` at all, so there is nothing
   * in the markup for a reader, a cache or a view-source to recover.
   *
   * THE PROVENANCE IS CARRIED BY THE WORDS, not by the colour: both quiet badge
   * tones render identically, and a state must never be conveyed by colour
   * alone.
   *
   * @return array<string, mixed>
   *   The `list` item.
   */
  private function envVars(BbTicketInterface $ticket): array {
    $effective = EnvVars::parse((string) $ticket->get('effective_env_vars')->value);
    if ($effective === []) {
      return $this->row('Env vars', $this->dash());
    }
    $own = EnvVars::parse((string) $ticket->get('env_vars')->value);
    $inherited = array_diff_key($effective, $own);

    return $this->row(
      'Env vars',
      // No `value` and no revealed content: the cell renders the withheld-value
      // token and there is nothing to reveal.
      ['kind' => 'masked', 'revealed' => FALSE],
      [
        'key' => ['kind' => 'mono', 'value' => implode(', ', array_keys($effective))],
        'origin' => [
          'kind' => 'badge',
          // `own` the moment the ticket sets any of them itself, because that
          // is the statement a reader acts on: an override here is what they
          // can change on this screen.
          'label' => count($inherited) === count($effective) ? 'inherited' : 'own',
          'tone' => 'neutral',
          // THE TWO EMPTY STRINGS ARE DATA, NOT PADDING, and they are the same
          // lie Storybook tells about the picker's `icon` told once more. The
          // cell macro forwards `icon: c.icon` and `suffix: c.suffix` to
          // `badge` UNCONDITIONALLY — unlike `tone`/`dot`/`mono`/`mine` it
          // gives neither a `|default()` — and both props are typed `string`,
          // so an absent key arrives at SDC as NULL and the render THROWS.
          // json-schema-faker invents values for them in Storybook, which is
          // why the scene declares neither and renders anyway.
          //
          // EMPTY RATHER THAN A SPRITE NAME because the scene is the design and
          // the scene's badge carries no icon and no suffix: the provenance is
          // carried by the WORDS (see above), and `badge.twig` skips both on a
          // falsy value, so this renders exactly the badge the scene shows.
          // Naming a real sprite here would put a mark on the screen that no
          // design asked for.
          'icon' => '',
          'suffix' => '',
        ],
      ],
    );
  }

  /**
   * A time field in seconds as a product duration — `4h 0m`, `45 min`.
   *
   * Both fields are stored in SECONDS and are agent-proposed and
   * human-confirmed, so the rail reads them rather than deriving them from run
   * footprints.
   *
   * @return array<string, mixed>
   *   The value cell.
   */
  private function duration(BbTicketInterface $ticket, string $field): array {
    $seconds = $ticket->get($field)->value;
    if ($seconds === NULL || $seconds === '') {
      return $this->dash();
    }
    return $this->text($this->date->duration((int) $seconds));
  }

  /**
   * A ticket-relation row: each related ticket a linked chip, side by side.
   *
   * A ticket the reader may not open stays an unlinked chip, so the row never
   * offers a link that answers 403.
   *
   * @return array<string, mixed>
   *   The `list` item.
   */
  private function relationRow(string $label, BbTicketInterface $ticket, string $field): array {
    $chips = [];
    foreach ($ticket->get($field)->referencedEntities() as $entity) {
      $identifier = $entity instanceof BbTicketInterface
        ? $entity->getIdentifier()
        : (string) $entity->label();
      $chip = $this->badge($identifier, 'neutral', ['mono' => TRUE]);
      $chips[] = $chip + ($entity->access('view') ? ['url' => $entity->toUrl()->toString()] : []);
    }
    return $this->chipsRow($label, $chips);
  }

  /**
   * Where the ticket is deployed: one linked chip per environment.
   *
   * Each deployment carrying the ticket adds a chip per environment it lists,
   * so a deployment without environments adds none.
   *
   * @return array<string, mixed>
   *   The `list` item.
   */
  private function deploymentsRow(string $label, BbTicketInterface $ticket): array {
    $chips = [];
    foreach ($ticket->get('deployments')->referencedEntities() as $deployment) {
      assert($deployment instanceof BbTicketInterface);
      foreach ($deployment->get('environments')->referencedEntities() as $environment) {
        $chips[] = $this->badge($environment->label() . ' · ' . $deployment->getIdentifier(), 'neutral', ['mono' => TRUE])
          + ['url' => $deployment->toUrl()->toString()];
      }
    }
    return $this->chipsRow($label, $chips);
  }

  /**
   * The runs summary row, carrying the summary's own cacheability.
   *
   * A dash, which the Properties block leaves out, when the reader would be
   * told "No runs yet" about runs they cannot see.
   *
   * @return array<string, mixed>
   *   The `list` item, with the summary's `#cache`.
   */
  private function runsRow(string $label, BbTicketInterface $ticket): array {
    $summary = $this->runSummary->forTicket($ticket->id());
    if ($summary === NULL) {
      return $this->row($label, $this->dash()) + ['#cache' => RunSummary::CACHE];
    }
    return $this->row($label, ['kind' => 'badge'] + $summary->badge()) + ['#cache' => $summary->build()['#cache']];
  }

  /**
   * A stall badge, degrading to a faint dash when the ticket is moving.
   *
   * A frozen stall carries when the hold started as the badge suffix.
   *
   * @return array<string, mixed>
   *   The value cell.
   */
  private function stall(BbTicketInterface $ticket): array {
    $reason = (string) $ticket->get('stall_reason')->value;
    if ($reason === '') {
      return $this->dash();
    }
    return ['kind' => 'badge'] + TicketStallReason::badge(
      $reason,
      $ticket->getFrozenAt(),
    );
  }

}
