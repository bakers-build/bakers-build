<?php

declare(strict_types=1);

namespace Drupal\bb_track;

/**
 * Strict calendar selection: context scope, period and filters.
 *
 * The single condition source for the time calendar's rows and totals. Every
 * value outside the offered options makes the selection invalid, which
 * matches nothing; a context or query value only narrows, never widens.
 *
 * @SuppressWarnings("PHPMD.ExcessiveParameterList")
 */
final class WorklogSelection {

  public const CONTEXTS = ['personal', 'workspace', 'team', 'project'];

  /**
   * Constructs a selection.
   *
   * @param bool $valid
   *   Whether every query value was acceptable.
   * @param string $context
   *   One of self::CONTEXTS.
   * @param string $mode
   *   Day or week.
   * @param string $date
   *   Selected Y-m-d date.
   * @param string $start
   *   Inclusive period start.
   * @param string $end
   *   Exclusive period end.
   * @param string $weekStart
   *   Monday of the selected week.
   * @param string $weekEnd
   *   Monday after the selected week, exclusive.
   * @param int|null $project
   *   Project filter.
   * @param int|null $ticket
   *   Ticket filter.
   * @param int|null $person
   *   Person filter.
   * @param int $viewer
   *   Viewing uid.
   * @param array{owners: list<int>|null, projects: list<int>|null} $scope
   *   Context scope: owners and projects, NULL for unrestricted.
   * @param array{projects: array<int|string, string>, tickets: array<int|string, string>, people: array<int|string, string>} $options
   *   Offered filter values keyed by id.
   * @param array{id: int, uuid: string}|null $submission
   *   The viewer's own submission the rows are limited to.
   */
  public function __construct(
    public readonly bool $valid,
    public readonly string $context,
    public readonly string $mode,
    public readonly string $date,
    public readonly string $start,
    public readonly string $end,
    public readonly string $weekStart,
    public readonly string $weekEnd,
    public readonly ?int $project,
    public readonly ?int $ticket,
    public readonly ?int $person,
    public readonly int $viewer,
    public readonly array $scope,
    public readonly array $options,
    public readonly ?array $submission = NULL,
  ) {}

  /**
   * Resolves GET query values into a selection, or an invalid marker.
   *
   * @param array<string, mixed> $query
   *   Request query.
   * @param string $context
   *   One of self::CONTEXTS.
   * @param int $viewer
   *   Viewing uid.
   * @param \DateTimeZone $timezone
   *   Actor timezone.
   * @param array{projects: array<int|string, string>, tickets: array<int|string, string>, people: array<int|string, string>} $options
   *   Offered filter values keyed by id.
   * @param array{owners: list<int>|null, projects: list<int>|null} $scope
   *   Context scope.
   * @param array{id: int, uuid: string}|false|null $submission
   *   The resolved own submission, FALSE for one that is not the viewer's.
   */
  public static function fromQuery(array $query, string $context, int $viewer, \DateTimeZone $timezone, array $options, array $scope, array|false|null $submission = NULL): self {
    $today = (new \DateTimeImmutable('now', $timezone))->format('Y-m-d');
    $mode = self::parsedMode($query['mode'] ?? 'week');
    $date = self::parsedDate($query['date'] ?? $today);
    $raw_ids = self::parsedIds($query, $options);
    $valid = self::isValid($mode, $date, $raw_ids, $context, $submission);
    $mode ??= 'week';
    $ids = array_map(static fn (int|false|null $id): ?int => $valid && is_int($id) ? $id : NULL, $raw_ids);
    $anchor = $date ?? new \DateTimeImmutable($today);
    $week_start = $anchor->modify('-' . ((int) $anchor->format('N') - 1) . ' days');
    $start = $mode === 'week' ? $week_start : $anchor;
    return new self(
      $valid,
      $context,
      $mode,
      $anchor->format('Y-m-d'),
      $start->format('Y-m-d'),
      $start->modify($mode === 'week' ? '+7 days' : '+1 day')->format('Y-m-d'),
      $week_start->format('Y-m-d'),
      $week_start->modify('+7 days')->format('Y-m-d'),
      $ids['project'],
      $ids['ticket'],
      $ids['person'],
      $viewer,
      $scope,
      $options,
      $valid && is_array($submission) ? $submission : NULL,
    );
  }

  /**
   * Whether every query value was acceptable.
   *
   * @param string|null $mode
   *   Parsed day or week mode, or NULL for an invalid value.
   * @param \DateTimeImmutable|null $date
   *   Parsed date, or NULL for an invalid value.
   * @param array<string, int|false|null> $raw_ids
   *   Parsed project, ticket and person filter values.
   * @param string $context
   *   One of self::CONTEXTS.
   * @param array{id: int, uuid: string}|false|null $submission
   *   The resolved own submission, FALSE for one that is not the viewer's.
   */
  private static function isValid(?string $mode, ?\DateTimeImmutable $date, array $raw_ids, string $context, array|false|null $submission): bool {
    return $mode !== NULL && $date !== NULL && !in_array(FALSE, $raw_ids, TRUE)
      && in_array($context, self::CONTEXTS, TRUE) && $submission !== FALSE;
  }

  /**
   * Parses the raw project, ticket and person filter values.
   *
   * @param array<string, mixed> $query
   *   Request query.
   * @param array{projects: array<int|string, string>, tickets: array<int|string, string>, people: array<int|string, string>} $options
   *   Offered filter values keyed by id.
   *
   * @return array<string, int|false|null>
   *   Parsed ids keyed by project, ticket and person.
   */
  private static function parsedIds(array $query, array $options): array {
    $ids = [];
    foreach (['project' => 'projects', 'ticket' => 'tickets', 'person' => 'people'] as $key => $offered) {
      $ids[$key] = self::parsedId($query[$key] ?? '', $options[$offered]);
    }
    return $ids;
  }

  /**
   * Label of the selected project, ticket or person; empty when unset.
   *
   * @param string $key
   *   Project, ticket or person.
   */
  public function label(string $key): string {
    $value = match ($key) {
      'project' => $this->project,
      'ticket' => $this->ticket,
      'person' => $this->person,
      default => NULL,
    };
    $offered = ['project' => 'projects', 'ticket' => 'tickets', 'person' => 'people'][$key] ?? '';
    return $value === NULL ? '' : (string) ($this->options[$offered][$value] ?? '');
  }

  /**
   * Context and filter conditions on worklog fields, without the period.
   *
   * @return list<array{0: string, 1: mixed, 2: string}>
   *   Field, value and operator.
   */
  public function conditions(): array {
    return $this->conditionsFor(['recorded', 'approved']);
  }

  /**
   * Conditions of the viewer's own proposed rows in this selection.
   *
   * @return list<array{0: string, 1: mixed, 2: string}>
   *   Field, value and operator; matches nothing outside own calendars.
   */
  public function proposedConditions(): array {
    if (!$this->isOwn()) {
      return [['id', 0, '=']];
    }
    return [...$this->conditionsFor(['proposed']), ['owner_user_id', $this->viewer, '=']];
  }

  /**
   * Conditions of the listed rows: recorded time, plus own proposed time.
   *
   * @return list<array{0: string, 1: mixed, 2: string}>
   *   Field, value and operator.
   */
  public function rowConditions(): array {
    return $this->conditionsFor($this->isOwn() ? ['recorded', 'approved', 'proposed'] : ['recorded', 'approved']);
  }

  /**
   * Whether this calendar shows only the viewer's own time.
   */
  public function isOwn(): bool {
    return $this->valid && $this->viewer > 0
      && in_array($this->context, ['personal', 'workspace'], TRUE)
      && $this->scope['owners'] === [$this->viewer];
  }

  /**
   * Context, filter and state conditions.
   *
   * @param list<string> $states
   *   Allowed states.
   *
   * @return list<array{0: string, 1: mixed, 2: string}>
   *   Field, value and operator.
   */
  private function conditionsFor(array $states): array {
    $nothing = [['id', 0, '=']];
    if (!$this->valid) {
      return $nothing;
    }
    $conditions = [
      ['voided', 0, '='],
      ['state', $states, 'IN'],
    ];
    if ($this->submission !== NULL) {
      $conditions[] = ['submission_id', $this->submission['id'], '='];
    }
    foreach (['owners' => 'owner_user_id', 'projects' => 'project_id'] as $key => $field) {
      $values = $this->scope[$key];
      if ($values === NULL) {
        continue;
      }
      if ($values === []) {
        return $nothing;
      }
      $conditions[] = [$field, $values, 'IN'];
    }
    foreach (['project_id' => $this->project, 'ticket_id' => $this->ticket, 'owner_user_id' => $this->person] as $field => $value) {
      if ($value !== NULL) {
        $conditions[] = [$field, $value, '='];
      }
    }
    return $conditions;
  }

  /**
   * Query values that reproduce this selection.
   *
   * @return array<string, string>
   *   Mode, date and present filters.
   */
  public function query(): array {
    $query = ['mode' => $this->mode, 'date' => $this->date];
    foreach (['project' => $this->project, 'ticket' => $this->ticket, 'person' => $this->person] as $key => $value) {
      if ($value !== NULL) {
        $query[$key] = (string) $value;
      }
    }
    if ($this->submission !== NULL) {
      $query['submission'] = $this->submission['uuid'];
    }
    return $query;
  }

  /**
   * Accepts day or week, otherwise NULL.
   */
  private static function parsedMode(mixed $mode): ?string {
    return is_string($mode) && in_array($mode, ['day', 'week'], TRUE) ? $mode : NULL;
  }

  /**
   * Parses a calendar date, otherwise NULL.
   */
  private static function parsedDate(mixed $date): ?\DateTimeImmutable {
    if (!is_string($date) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
      return NULL;
    }
    $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    if (!$parsed instanceof \DateTimeImmutable || $parsed->format('Y-m-d') !== $date) {
      return NULL;
    }
    return $parsed;
  }

  /**
   * Parses an offered id; empty means no filter, FALSE means invalid.
   *
   * @param mixed $raw
   *   Raw query value.
   * @param array<int|string, string> $options
   *   Offered values keyed by id.
   */
  private static function parsedId(mixed $raw, array $options): int|false|null {
    if ($raw === '' || $raw === NULL) {
      return NULL;
    }
    if (!is_string($raw) || preg_match('/^[1-9]\d*$/', $raw) !== 1 || !isset($options[$raw])) {
      return FALSE;
    }
    return (int) $raw;
  }

}
