<?php

declare(strict_types=1);

namespace Drupal\bb_track\Statistics;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Plugin\Field\FieldFormatter\PersonIdentityTrait;
use Drupal\bb_core\Statistics\Period\PeriodRange;
use Drupal\bb_track\WorkAssignments;
use Drupal\user\UserInterface;

/**
 * Hours and AI tokens of one workspace and period, as a billing tree.
 *
 * Hours are recorded and approved, unvoided worklogs, counted on the
 * worklog's own billing account by work date. Tokens are run tokens by run
 * start, counted on the ticket's resolved account; a ticket with none lands
 * in "No billing account". By person, hours belong to the worklog's owner
 * and tokens to the ticket's assignee.
 *
 * A node is `['key', 'kind', 'label', 'entity', 'hours', 'approved',
 * 'recorded', 'tokens', 'external_id', 'default', 'tickets', 'people',
 * 'children']`: seconds, tokens, an account's external ID and default flag
 * (NULL and FALSE elsewhere), the distinct ticket ids as keys and the
 * people's initials by user id. Every parent sums its
 * children, because each contribution is added to every node on its path.
 */
final class BillingReport {

  use StringTranslationTrait;
  use PersonIdentityTrait;

  /**
   * Worklog states that count as billable time.
   */
  public const STATES = ['recorded', 'approved'];

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly WorkAssignments $assignments,
  ) {}

  /**
   * The top-level nodes of the report.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The period.
   * @param array{account?: list<int>, project?: list<int>} $filters
   *   Account and project ids of this workspace, already validated.
   * @param string $group
   *   Either `account` or `person`.
   *
   * @return list<array<string, mixed>>
   *   The top-level nodes, unsorted.
   */
  public function build(BbWorkspaceInterface $workspace, PeriodRange $period, array $filters, string $group): array {
    $projects = $this->projectIds($workspace, $filters['project'] ?? []);
    if ($projects === []) {
      return [];
    }
    $accounts = $filters['account'] ?? [];
    $rows = [...$this->hours($projects, $accounts, $period), ...$this->tokens($projects, $accounts, $period)];
    $entities = $this->entities($rows);
    $initials = array_map(fn(EntityInterface $user): string => $user instanceof UserInterface ? $this->personInitials($this->personDisplayName($user)) : '', $entities['person']);
    $root = ['children' => []];
    foreach ($rows as $row) {
      $this->add($root, $this->path($row, $group, $entities), $row, $initials);
    }
    return self::lists($root)['children'];
  }

  /**
   * The accounts and projects that have a row in the period, unfiltered.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The period.
   * @param list<array<string, mixed>>|null $unfiltered
   *   This period's build without entity filters, in either grouping, when
   *   the caller has one; NULL builds it here.
   *
   * @return array{account: list<\Drupal\Core\Entity\EntityInterface>, project: list<\Drupal\Core\Entity\EntityInterface>}
   *   Entities in name order.
   */
  public function options(BbWorkspaceInterface $workspace, PeriodRange $period, ?array $unfiltered = NULL): array {
    $options = ['account' => [], 'project' => []];
    $walk = static function (array $nodes) use (&$walk, &$options): void {
      foreach ($nodes as $node) {
        if (isset($options[$node['kind']]) && $node['entity'] instanceof EntityInterface) {
          $options[$node['kind']][$node['entity']->id()] = $node['entity'];
        }
        // Tickets sit below projects and hold no option.
        if ($node['kind'] !== 'project') {
          $walk($node['children']);
        }
      }
    };
    $walk($unfiltered ?? $this->build($workspace, $period, [], 'account'));
    return array_map(static function (array $entities): array {
      usort($entities, static fn(EntityInterface $left, EntityInterface $right): int => strnatcasecmp((string) $left->label(), (string) $right->label()));
      return $entities;
    }, $options);
  }

  /**
   * The workspace's project ids, narrowed to the selected ones.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param list<int> $selected
   *   Selected project ids, or none for all.
   *
   * @return list<int>
   *   Project ids.
   */
  private function projectIds(BbWorkspaceInterface $workspace, array $selected): array {
    $query = $this->entityTypeManager->getStorage('bb_project')->getQuery()
      ->accessCheck(FALSE)
      ->condition('group_id.entity.workspace_id', $workspace->id());
    if ($selected !== []) {
      $query->condition('id', $selected, 'IN');
    }
    return array_map('intval', array_values($query->execute()));
  }

  /**
   * Billable seconds per account, project, ticket, owner and state.
   *
   * @param list<int> $projects
   *   Project ids.
   * @param list<int> $accounts
   *   Account ids to keep, or none for all.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The period; work dates count inclusively.
   *
   * @return list<array<string, int>>
   *   Contributions.
   */
  private function hours(array $projects, array $accounts, PeriodRange $period): array {
    $query = $this->entityTypeManager->getStorage('bb_track_worklog')->getAggregateQuery()
      ->accessCheck(FALSE)
      ->condition('project_id', $projects, 'IN')
      ->condition('state', self::STATES, 'IN')
      ->condition('voided', 1, '<>')
      ->condition('work_date', $period->start, '>=')
      ->condition('work_date', $period->end, '<=')
      ->groupBy('account_id')
      ->groupBy('project_id')
      ->groupBy('ticket_id')
      ->groupBy('owner_user_id')
      ->groupBy('state')
      ->aggregate('duration_seconds', 'SUM');
    if ($accounts !== []) {
      $query->condition('account_id', $accounts, 'IN');
    }
    $rows = [];
    /** @var list<array<string, string|null>> $result */
    $result = $query->execute();
    foreach ($result as $row) {
      $seconds = (int) $row['duration_seconds_sum'];
      $rows[] = [
        'account' => (int) $row['account_id'],
        'project' => (int) $row['project_id'],
        'ticket' => (int) $row['ticket_id'],
        'person' => (int) $row['owner_user_id'],
        'hours' => $seconds,
        'approved' => $row['state'] === 'approved' ? $seconds : 0,
        'recorded' => $row['state'] === 'recorded' ? $seconds : 0,
        'tokens' => 0,
      ];
    }
    return $rows;
  }

  /**
   * Run tokens per ticket, on the ticket's resolved account and assignee.
   *
   * @param list<int> $projects
   *   Project ids.
   * @param list<int> $accounts
   *   Account ids to keep, or none for all; a filter drops tokens without
   *   an account.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The period; run starts count from its first to its last second.
   *
   * @return list<array<string, int>>
   *   Contributions.
   */
  private function tokens(array $projects, array $accounts, PeriodRange $period): array {
    $sums = [];
    /** @var list<array<string, string|null>> $result */
    $result = $this->entityTypeManager->getStorage('bb_run')->getAggregateQuery()
      ->accessCheck(FALSE)
      ->condition('ticket_id.entity.project_id', $projects, 'IN')
      ->condition('created', $period->from(), '>=')
      ->condition('created', $period->to(), '<=')
      ->groupBy('ticket_id')
      ->aggregate('tokens', 'SUM')
      ->execute();
    foreach ($result as $row) {
      if ((int) $row['tokens_sum'] > 0) {
        $sums[(int) $row['ticket_id']] = (int) $row['tokens_sum'];
      }
    }
    $by_project = [];
    /** @var array<int, \Drupal\Core\Entity\ContentEntityInterface> $tickets */
    $tickets = $this->entityTypeManager->getStorage('bb_ticket')->loadMultiple(array_keys($sums));
    foreach ($tickets as $ticket) {
      $by_project[(int) $ticket->get('project_id')->target_id][] = (int) $ticket->id();
    }
    $rows = [];
    foreach ($by_project as $project => $ids) {
      foreach ($this->assignments->resolutions($project, $ids) as $ticket => $account) {
        $account = (int) $account?->id();
        if ($accounts !== [] && !in_array($account, $accounts, TRUE)) {
          continue;
        }
        $rows[] = [
          'account' => $account,
          'project' => $project,
          'ticket' => $ticket,
          'person' => (int) $tickets[$ticket]->get('assignee_user_id')->target_id,
          'hours' => 0,
          'approved' => 0,
          'recorded' => 0,
          'tokens' => $sums[$ticket],
        ];
      }
    }
    return $rows;
  }

  /**
   * The accounts, projects, tickets and people the rows name, loaded once.
   *
   * @param list<array<string, int>> $rows
   *   Contributions.
   *
   * @return array<string, array<int, \Drupal\Core\Entity\ContentEntityInterface>>
   *   Entities by row field and id.
   */
  private function entities(array $rows): array {
    $types = ['account' => 'bb_track_account', 'project' => 'bb_project', 'ticket' => 'bb_ticket', 'person' => 'user'];
    $entities = [];
    foreach ($types as $field => $type) {
      $ids = array_filter(array_unique(array_column($rows, $field)));
      $loaded = $ids === [] ? [] : $this->entityTypeManager->getStorage($type)->loadMultiple($ids);
      $entities[$field] = array_filter($loaded, static fn(EntityInterface $entity): bool => $entity instanceof ContentEntityInterface);
    }
    return $entities;
  }

  /**
   * The nodes one contribution belongs to, top level first.
   *
   * @param array<string, int> $row
   *   A contribution.
   * @param string $group
   *   Either `account` or `person`.
   * @param array<string, array<int, \Drupal\Core\Entity\ContentEntityInterface>> $entities
   *   Loaded entities.
   *
   * @return list<array<string, mixed>>
   *   The path.
   */
  private function path(array $row, string $group, array $entities): array {
    $account = $entities['account'][$row['account']] ?? NULL;
    $project = $entities['project'][$row['project']] ?? NULL;
    $ticket = $entities['ticket'][$row['ticket']] ?? NULL;
    $path = [
      $account === NULL
        ? self::node('n', 'none', (string) $this->t('No billing account'))
        : [
          'external_id' => (string) $account->get('external_id')->value,
          'default' => (bool) $account->get('is_default')->value,
        ] + self::node('a' . $row['account'], 'account', (string) $account->label(), $account),
      self::node('p' . $row['account'] . '-' . $row['project'], 'project', (string) $project?->label(), $project),
      $ticket === NULL
        ? self::node('w' . $row['project'], 'no_ticket', (string) $this->t('Without ticket'))
        : self::node('t' . $row['ticket'], 'ticket', $ticket->get('identifier')->value . ' · ' . $ticket->get('title')->value, $ticket),
    ];
    if ($group !== 'person') {
      return $path;
    }
    $person = $entities['person'][$row['person']] ?? NULL;
    $top = $person instanceof UserInterface
      ? self::node('u' . $row['person'], 'person', $this->personDisplayName($person), $person)
      : self::node('u0', 'unassigned', (string) $this->t('Unassigned'));
    // Prefixed, so an expanded account under one person stays closed under
    // another.
    $prefixed = static fn(array $node): array => ['key' => $top['key'] . '.' . $node['key']] + $node;
    return [$top, ...array_map($prefixed, $path)];
  }

  /**
   * An empty node.
   *
   * @return array<string, mixed>
   *   The node.
   */
  private static function node(string $key, string $kind, string $label, ?EntityInterface $entity = NULL): array {
    return [
      'key' => $key,
      'kind' => $kind,
      'label' => $label,
      'entity' => $entity,
      'hours' => 0,
      'approved' => 0,
      'recorded' => 0,
      'tokens' => 0,
      'external_id' => NULL,
      'default' => FALSE,
      'tickets' => [],
      'people' => [],
      'children' => [],
    ];
  }

  /**
   * Adds a contribution to every node on its path.
   *
   * @param array<string, mixed> $parent
   *   The node to descend from, changed in place.
   * @param list<array<string, mixed>> $path
   *   The remaining path.
   * @param array<string, int> $row
   *   The contribution.
   * @param array<int, string> $initials
   *   People's initials by user id.
   */
  private function add(array &$parent, array $path, array $row, array $initials): void {
    $step = array_shift($path);
    if ($step === NULL) {
      return;
    }
    $node = &$parent['children'][$step['key']];
    $node ??= $step;
    foreach (['hours', 'approved', 'recorded', 'tokens'] as $sum) {
      $node[$sum] += $row[$sum];
    }
    if ($row['ticket'] > 0) {
      $node['tickets'][$row['ticket']] = TRUE;
    }
    if ($row['person'] > 0) {
      $node['people'][$row['person']] = $initials[$row['person']] ?? '';
    }
    $this->add($node, $path, $row, $initials);
  }

  /**
   * Turns keyed children into lists, all the way down.
   *
   * @param array<string, mixed> $node
   *   A node with keyed children.
   *
   * @return array<string, mixed>
   *   The node with listed children.
   */
  private static function lists(array $node): array {
    $node['children'] = array_values(array_map(self::lists(...), $node['children']));
    return $node;
  }

}
