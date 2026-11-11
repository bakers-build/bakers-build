<?php

declare(strict_types=1);

namespace Drupal\bb_board\Plugin\views\area;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\facets\Result\ResultInterface;
use Drupal\bb_board\BoardAddress;
use Drupal\bb_board\BoardHealth;
use Drupal\bb_board\BoardPreferences;
use Drupal\bb_board\ProjectBoardFilterBar;
use Drupal\bb_board\ProjectBoardSummary;
use Drupal\bb_board\Plugin\views\filter\BbBoardParent;
use Drupal\bb_core\Plugin\views\filter\BbTicketSearch;
use Drupal\search_api\Plugin\views\query\SearchApiQuery;
use Drupal\views\Attribute\ViewsArea;
use Drupal\views\Plugin\views\area\AreaPluginBase;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The Project Board's filter bar, active filter chips and open ticket total.
 *
 * Placed on the page display, whose own search carries every board filter but
 * no column and no meaningful pager. query() asks that search for its result
 * count and OR aggregations: each dimension counts under every OTHER filter
 * but not its own, exactly like a facet. Those counts feed the State and
 * Priority pickers and the Assignee avatars of the exposed form, which this
 * area renders as the filter bar. Below it, each active filter is a chip with
 * what it matches on its own, then "N of M open tickets".
 *
 * @see \Drupal\bb_board\Hook\ProjectBoardSummaryHooks
 *
 * @SuppressWarnings("PHPMD.BooleanArgumentFlag")
 */
#[ViewsArea('bb_board_summary')]
final class BbBoardSummary extends AreaPluginBase {

  /**
   * The Search API query option that asks for the summary aggregations.
   */
  public const OPTION = 'bb_board_summary';

  /**
   * Aggregation key for the per-assignee counts.
   */
  public const EMPLOYEES = 'bb_board_employees';

  /**
   * Aggregation key for the per-state counts.
   */
  public const STATES = 'bb_board_states';

  /**
   * Aggregation key for the per-priority counts.
   */
  public const PRIORITIES = 'bb_board_priorities';

  /**
   * The exposed identifier of the shared Assignee facet.
   */
  private const ASSIGNEE = 'assignee';

  /**
   * The exposed identifier of the shared State facet.
   */
  private const STATE = 'state';

  /**
   * The Assignee facet filter id on the board.
   */
  private const ASSIGNEE_FILTER = 'facets_assignee_user_id';

  /**
   * The exposed identifier of the shared Priority facet.
   */
  private const PRIORITY = 'priority';

  /**
   * The Priority facet filter id on the board.
   */
  private const PRIORITY_FILTER = 'facets_priority';

  /**
   * The exposed identifier of the Parent filter.
   */
  private const PARENT = 'parent_id';

  /**
   * The exposed identifier of the ticket search.
   */
  private const SEARCH = 'search';

  /**
   * Turns the aggregations into labelled, ordered rows.
   */
  private ProjectBoardSummary $rows;

  /**
   * The Details preference the segmented control shows.
   */
  private BoardPreferences $preferences;

  /**
   * Records failed summary searches.
   */
  private LoggerInterface $logger;

  /**
   * The Unhealthy filter's rule, the attention set and the board's project.
   */
  private BoardHealth $health;

  /**
   * The board address, once per executed view.
   */
  private ?BoardAddress $address = NULL;

  /**
   * The computed summary, once per executed view.
   *
   * @var array<string, mixed>|null
   */
  private ?array $summary = NULL;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): static {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->rows = $container->get(ProjectBoardSummary::class);
    $instance->preferences = $container->get(BoardPreferences::class);
    $instance->logger = $container->get('logger.channel.bb_core');
    $instance->health = $container->get(BoardHealth::class);
    return $instance;
  }

  /**
   * The search aggregations the summary reads.
   *
   * `operator: or` drops the facet's own condition group (tagged
   * `facet:<field>` by the facets query type) and keeps every other filter.
   *
   * @return array<string, array<string, mixed>>
   *   Search API facet requests, keyed by aggregation key.
   */
  public static function aggregations(): array {
    $request = ['limit' => 0, 'min_count' => 1, 'missing' => TRUE, 'operator' => 'or'];
    return [
      self::EMPLOYEES => ['field' => 'assignee_user_id'] + $request,
      self::STATES => ['field' => 'state'] + $request,
      self::PRIORITIES => ['field' => 'priority'] + $request,
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function query(): void {
    if (!$this->view->query instanceof SearchApiQuery) {
      return;
    }
    $search = $this->view->query->getSearchApiQuery();
    $search?->setOption('skip result count', FALSE);
    $search?->setOption(self::OPTION, TRUE);
  }

  /**
   * The summary of the executed search.
   *
   * @return array<string, mixed>
   *   Keys: `status` (`ok`, `invalid` for bad parent or search input, `error`
   *   when the search failed; only `ok` carries counts), `mode` (`project`,
   *   `parent`), `parent` label or NULL, `message` or NULL, `total`, `open`
   *   (the open tickets before the clearable filters, NULL when unknown),
   *   `employees`, `states` and `priorities` (rows of value/label/count/active)
   *   and `chips` (the active filters: field, values, count, remove_url).
   */
  public function summary(): array {
    if ($this->summary !== NULL) {
      return $this->summary;
    }
    $scope = $this->scope();
    $summary = $this->scoped($scope);
    $refusal = ($scope['mode'] ?? '') === 'invalid' ? $scope['message'] : $this->searchError();
    if ($refusal !== NULL) {
      return $this->summary = ['status' => 'invalid', 'message' => $refusal] + $summary;
    }

    $searched = empty($this->view->build_info['abort']) ? $this->searched() : NULL;
    if ($searched === NULL) {
      $this->logger->error('The project board summary search failed for view @view.', ['@view' => $this->view->id()]);
      return $this->summary = [
        'status' => 'error',
        'message' => new TranslatableMarkup('Metrics could not be loaded.'),
      ] + $summary;
    }
    return $this->summary = $this->counted($summary, $searched);
  }

  /**
   * The summary skeleton for a scope: mode and parent label, no counts yet.
   *
   * @param array<string, mixed>|null $scope
   *   The parent filter's scope, NULL without a parent.
   *
   * @return array<string, mixed>
   *   The summary with status `ok` and zero counts.
   */
  private function scoped(?array $scope): array {
    $parent = $scope['parent'] ?? NULL;
    return [
      'status' => 'ok',
      'mode' => ($scope['mode'] ?? 'project') === 'project' ? 'project' : 'parent',
      'parent' => $parent === NULL ? NULL : $parent->getIdentifier() . ' ' . $parent->getTitle(),
      'message' => NULL,
      'total' => 0,
      'open' => NULL,
      'employees' => [],
      'priorities' => [],
      'states' => [],
      'chips' => [],
    ];
  }

  /**
   * The summary filled from a successful search.
   *
   * @param array<string, mixed> $summary
   *   The skeleton from scoped().
   * @param array{total: int, aggregations: array<string, mixed>} $searched
   *   The search's count and aggregations.
   *
   * @return array<string, mixed>
   *   The counted summary.
   */
  private function counted(array $summary, array $searched): array {
    $aggregations = $searched['aggregations'];
    $active = $this->address()->active(self::ASSIGNEE);
    $summary['total'] = $searched['total'];
    $summary['employees'] = $this->rows->employees(
      $aggregations[self::EMPLOYEES] ?? [],
      $active,
      $this->missingToken(self::ASSIGNEE_FILTER, $active),
    );
    $priorities = $this->address()->active(self::PRIORITY);
    $summary['priorities'] = $this->rows->priorities(
      $aggregations[self::PRIORITIES] ?? [],
      $priorities,
      $this->missingToken(self::PRIORITY_FILTER, $priorities),
    );
    $summary['states'] = $this->rows->states($aggregations[self::STATES] ?? [], $this->address()->active(self::STATE));
    if ($summary['total'] === 0) {
      $summary['message'] = $summary['mode'] === 'parent'
        ? new TranslatableMarkup('No open descendants match these filters.')
        : new TranslatableMarkup('No tickets match these filters.');
    }
    return $this->withChips($summary);
  }

  /**
   * The summary with its active filter chips and open ticket total.
   *
   * A chip counts what its own filter matches inside the focus: the project's
   * open tickets, inside the parent focus, which "Clear filters" keeps. The
   * focus is also the "M" of "N of M open tickets", and the parent's chip
   * counts it. Nothing clearable chosen, the focus is what the board shows.
   *
   * @param array<string, mixed> $summary
   *   The counted summary.
   *
   * @return array<string, mixed>
   *   The summary with `chips` and `open`.
   */
  private function withChips(array $summary): array {
    $focus = $this->address()->clear() === NULL
      ? ['total' => $summary['total'], 'aggregations' => []]
      : $this->count();
    $summary['open'] = $focus['total'] ?? NULL;
    $chips = $summary['mode'] === 'parent'
      ? [$this->chip((string) $this->t('Parent'), [(string) $summary['parent']], $summary['open'], self::PARENT)]
      : [];
    $search = $this->address()->active(self::SEARCH)[0] ?? '';
    if ($search !== '') {
      $chips[] = $this->chip((string) $this->t('Search'), [$search], $this->count(search: $search)['total'] ?? NULL, self::SEARCH);
    }
    $chips = [...$chips, ...$this->facetChips($summary, $focus['aggregations'] ?? NULL)];
    if ($this->health->requested($this->view)) {
      $ids = $this->health->unhealthyIds($this->view);
      $chips[] = $this->chip((string) $this->t('Unhealthy'), [], $this->count($ids)['total'] ?? NULL, BoardHealth::PARAMETER);
    }
    $summary['chips'] = $chips;
    return $summary;
  }

  /**
   * The State, Priority and Assignee chips, each counted on its own.
   *
   * @param array<string, mixed> $summary
   *   The counted summary, for the value labels.
   * @param array<string, mixed>|null $aggregations
   *   The focus's per-facet counts, NULL when unknown.
   *
   * @return list<array<string, mixed>>
   *   One chip per facet with a chosen value.
   */
  private function facetChips(array $summary, ?array $aggregations): array {
    $chips = [];
    foreach ([
      [self::STATE, (string) $this->t('State'), $summary['states'], self::STATES],
      [self::PRIORITY, (string) $this->t('Priority'), $summary['priorities'], self::PRIORITIES],
      [self::ASSIGNEE, (string) $this->t('Assignee'), $summary['employees'], self::EMPLOYEES],
    ] as [$identifier, $field, $rows, $aggregation]) {
      $values = $this->address()->active($identifier);
      if ($values === []) {
        continue;
      }
      $labels = array_column(array_filter($rows, static fn (array $row): bool => $row['value'] !== NULL), 'label', 'value');
      $chips[] = $this->chip(
        $field,
        array_map(static fn (string $value): string => (string) ($labels[$value] ?? $value), $values),
        $aggregations === NULL ? NULL : $this->rows->alone($aggregations[$aggregation] ?? [], $values),
        $identifier,
      );
    }
    return $chips;
  }

  /**
   * Counts the focus, optionally only some tickets or a search line.
   *
   * @param list<int>|null $ids
   *   Only these tickets, NULL for no such limit.
   * @param string $search
   *   A search line.
   *
   * @return array{total: int, aggregations: array<string, mixed>}|null
   *   See ProjectBoardSummary::focus().
   */
  private function count(?array $ids = NULL, string $search = ''): ?array {
    $project = $this->health->project($this->view);
    $scope = $this->scope();
    $within = ($scope['mode'] ?? 'project') === 'project' ? NULL : array_values(array_map('intval', $scope['ticket_ids'] ?? []));
    return $project === NULL ? ['total' => 0, 'aggregations' => []] : $this->rows->focus($project, $within, $ids, $search);
  }

  /**
   * One active filter chip; it carries a count only when its search ran.
   *
   * @param string $field
   *   The filter's name.
   * @param list<string> $values
   *   The chosen values, empty for a filter that is a state.
   * @param int|null $count
   *   What the filter matches on its own, NULL when unknown.
   * @param string $identifier
   *   The query parameter its removal drops.
   *
   * @return array<string, mixed>
   *   An `active-filters` facet.
   */
  private function chip(string $field, array $values, ?int $count, string $identifier): array {
    $chip = ['field' => $field, 'values' => $values, 'remove_url' => $this->address()->without($identifier)];
    return $count === NULL ? $chip : $chip + ['count' => $count];
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The filter bar, then the active filters or the refusal.
   */
  public function render($empty = FALSE): array {
    $summary = $this->summary();
    $bar = new ProjectBoardFilterBar($this->address());
    $content = ['filters' => $this->filterBar($summary, $bar)];
    $content['active'] = $summary['status'] === 'ok'
      ? $bar->activeFilters($summary['chips'], $summary['total'], $summary['open'])
      : [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => (string) $summary['message'], 'icon' => 'inbox', 'compact' => TRUE],
      ];

    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'md'],
      '#slots' => ['content' => $content],
    ];
    // shortcut: counts are uncacheable like the board itself; add complete
    // invalidation only if measured board cost warrants it.
    $metadata = new CacheableMetadata();
    $metadata->setCacheMaxAge(0);
    $metadata->addCacheContexts(['user', 'route', 'url.query_args']);
    $metadata->addCacheTags(['search_api_list:bb_tickets']);
    $metadata->applyTo($build);
    return $build;
  }

  /**
   * The exposed form as the filter bar: counts, avatars, Details and Clear.
   *
   * The theme's exposed-form template lays the parts out in one row. A
   * refused or failed summary has no rows, so nothing is counted.
   *
   * @param array<string, mixed> $summary
   *   The summary.
   * @param \Drupal\bb_board\ProjectBoardFilterBar $bar
   *   The filter bar parts for this request.
   *
   * @return array<string, mixed>
   *   The exposed form, empty when the display has none.
   */
  private function filterBar(array $summary, ProjectBoardFilterBar $bar): array {
    $form = $this->view->exposed_widgets ?: [];
    if ($form === []) {
      return [];
    }
    $form[self::SEARCH]['#title_display'] = 'invisible';
    $form[self::SEARCH]['#compact'] = TRUE;
    $form[self::STATE] = $bar->pill($form[self::STATE] ?? [], $summary['states']);
    $form[self::PRIORITY] = $bar->pill($form[self::PRIORITY] ?? [], $summary['priorities']);
    $form['board_assignees'] = $bar->assignees($summary['employees']);
    $form['board_details'] = $bar->details($this->preferences->details());
    $form['board_clear'] = $bar->clear();
    $form['board_health'] = $bar->health($this->health->requested($this->view));
    return $form;
  }

  /**
   * The executed search's count and aggregations, NULL when it failed.
   *
   * A nonzero result without the requested aggregations is a failure too: an
   * absent count must never read as zero.
   *
   * @return array{total: int, aggregations: array<string, mixed>}|null
   *   The result count and the `search_api_facets` extra data.
   */
  private function searched(): ?array {
    $query = $this->view->query;
    if (!$query instanceof SearchApiQuery) {
      return NULL;
    }
    if ($query->shouldAbort()) {
      // A filter that aborts on purpose (a leaf parent, an empty identifier
      // set) leaves no message: an honest empty result. A failed search
      // aborts with the exception's message.
      $search = $query->getSearchApiQuery();
      return $search !== NULL && $search->getAbortMessage() === NULL
        ? ['total' => 0, 'aggregations' => []]
        : NULL;
    }
    $results = $query->getSearchApiResults();
    $total = (int) $results->getResultCount();
    $aggregations = $results->getExtraData('search_api_facets', []);
    if ($total > 0 && !isset($aggregations[self::EMPLOYEES], $aggregations[self::STATES], $aggregations[self::PRIORITIES])) {
      return NULL;
    }
    return ['total' => $total, 'aggregations' => $aggregations];
  }

  /**
   * The board address of this request.
   */
  private function address(): BoardAddress {
    return $this->address ??= BoardAddress::fromView($this->view);
  }

  /**
   * The search filter's message for an unresolvable reference, if any.
   *
   * Such a reference stops the view before it is built; it is the reader's
   * input to correct, not an empty result.
   */
  private function searchError(): ?string {
    foreach ($this->view->filter as $filter) {
      if ($filter instanceof BbTicketSearch && $filter->searchError() !== NULL) {
        return $filter->searchError();
      }
    }
    return NULL;
  }

  /**
   * The parent filter's resolved scope, NULL when no parent was given.
   *
   * @return array<string, mixed>|null
   *   See ParentTicketScope::resolve().
   */
  private function scope(): ?array {
    foreach ($this->view->filter as $filter) {
      if ($filter instanceof BbBoardParent) {
        return $filter->scope();
      }
    }
    return NULL;
  }

  /**
   * A facet's own value for "no value", NULL when it has none.
   *
   * Contrib encodes missing as `!(v1,v2,…)`: not any value present in the
   * facet's self-excluding results. Reading it from contrib's own missing
   * result, or reusing an active one, keeps the picker and this strip on one
   * value.
   *
   * @param string $filter_id
   *   The facet filter id.
   * @param list<string> $active
   *   The facet's active values.
   */
  private function missingToken(string $filter_id, array $active): ?string {
    foreach ($active as $value) {
      if (str_starts_with($value, '!(')) {
        return $value;
      }
    }
    // Built facet results once the exposed form was rebuilt after the search.
    foreach ($this->view->filter[$filter_id]->facet_results ?? [] as $result) {
      if ($result instanceof ResultInterface && $result->isMissing()) {
        return $result->getMissingFilters() === [] ? NULL : '!(' . implode(',', $result->getMissingFilters()) . ')';
      }
    }
    return NULL;
  }

}
