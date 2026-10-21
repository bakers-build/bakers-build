<?php

declare(strict_types=1);

namespace Drupal\bb_board\Plugin\views\area;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\facets\Result\ResultInterface;
use Drupal\bb_board\BoardAddress;
use Drupal\bb_board\ProjectBoardSummary;
use Drupal\bb_board\Plugin\views\filter\BbBoardParent;
use Drupal\bb_core\Plugin\views\filter\BbTicketSearch;
use Drupal\search_api\Plugin\views\query\SearchApiQuery;
use Drupal\views\Attribute\ViewsArea;
use Drupal\views\Plugin\views\area\AreaPluginBase;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * The Project Board's State, Assignee, Priority, Work state and Parent chips.
 *
 * Placed on the page display, whose own search carries every board filter but
 * no column and no meaningful pager. query() asks that search for its result
 * count and OR aggregations: each chip dimension counts under every OTHER
 * filter but not its own, exactly like a facet. The chips ARE those filters.
 * Work state chips default to the three open columns; Done is the fourth chip
 * and the Done column.
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
   * Aggregation key for the per-work-state counts.
   */
  public const WORK_STATES = 'bb_board_work_states';

  /**
   * Aggregation key for the per-parent counts.
   */
  public const PARENTS = 'bb_board_parents';

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
   * The exposed identifier of the Work state facet.
   */
  private const WORK_STATE = 'work_state';

  /**
   * The exposed identifier of the Parent filter.
   */
  private const PARENT = 'parent_id';

  /**
   * Turns the aggregations into labelled, ordered rows.
   */
  private ProjectBoardSummary $rows;

  /**
   * Records failed summary searches.
   */
  private LoggerInterface $logger;

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
    $instance->logger = $container->get('logger.channel.bb_core');
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
      self::WORK_STATES => ['field' => 'work_state'] + $request,
      self::PARENTS => ['field' => 'parent_id'] + $request,
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
   *   Keys: `status` (`ok`, `invalid` for bad parent input, `error` when the
   *   search failed; only `ok` carries counts), `mode` (`project`, `parent`),
   *   `parent` label or NULL, `message` or NULL, `total`, `employees`,
   *   `states`, `priorities`, `work_states` and `parents` (rows of
   *   value/label/count/active).
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
      'employees' => [],
      'priorities' => [],
      'states' => [],
      'work_states' => [],
      'parents' => [],
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
    $summary['work_states'] = $this->rows->workStates(
      $aggregations[self::WORK_STATES] ?? [],
      $this->address()->active(self::WORK_STATE),
    );
    $summary['parents'] = $this->rows->parents(
      $aggregations[self::PARENTS] ?? [],
      $this->parentOptions(),
      $this->address()->active(self::PARENT),
    );
    if ($summary['total'] === 0) {
      $summary['message'] = $summary['mode'] === 'parent'
        ? new TranslatableMarkup('No open descendants match these filters.')
        : new TranslatableMarkup('No tickets match these filters.');
    }
    return $summary;
  }

  /**
   * {@inheritdoc}
   *
   * @return array<string, mixed>
   *   The summary strip.
   */
  public function render($empty = FALSE): array {
    $summary = $this->summary();
    $content = [];
    $content['filters'] = $this->view->exposed_widgets ?: [];
    if ($summary['status'] !== 'ok') {
      $content['message'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => (string) $summary['message'], 'icon' => 'inbox', 'compact' => TRUE],
      ];
    }
    $cells = $this->cells($summary);
    $clear = $this->address()->clear();
    if ($clear !== NULL && $cells !== []) {
      $first = array_key_first($cells);
      $cells[$first]['#slots']['actions'] = $this->chip((string) $this->t('Clear filters'), $clear, FALSE, 'ghost');
    }
    if ($cells !== []) {
      $content['cells'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'none', 'gap' => 'md', 'columns' => 3],
        '#slots' => ['content' => $cells],
      ];
    }

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
    if ($total > 0 && !isset($aggregations[self::EMPLOYEES], $aggregations[self::STATES], $aggregations[self::WORK_STATES])) {
      return NULL;
    }
    return ['total' => $total, 'aggregations' => $aggregations];
  }

  /**
   * The board address of this request.
   */
  private function address(): BoardAddress {
    $request = $this->view->getRequest();
    return $this->address ??= new BoardAddress(
      $request->getBaseUrl() . $request->getPathInfo(),
      $request->query->all(),
      $this->view->getExposedInput(),
    );
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
   * Eligible parent choices for the Parent chips, UUID keyed.
   *
   * @return array<string, string>
   *   Ticket UUID => "IDENTIFIER Title".
   */
  private function parentOptions(): array {
    foreach ($this->view->filter as $filter) {
      if ($filter instanceof BbBoardParent) {
        return $filter->getValueOptions();
      }
    }
    return [];
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

  /**
   * The cells: Work state, State, Assignee, Priority and Parent facet chips.
   *
   * @param array<string, mixed> $summary
   *   The summary.
   *
   * @return array<string, array<string, mixed>>
   *   Zone render arrays; none for refusals and failures.
   */
  private function cells(array $summary): array {
    if ($summary['status'] !== 'ok') {
      return [];
    }
    $facets = [
      'work_states' => [self::WORK_STATE, $this->t('By work state'), $summary['work_states']],
      'states' => [self::STATE, $this->t('By state'), $summary['states']],
      'employees' => [self::ASSIGNEE, $this->t('By assignee'), $summary['employees']],
      'priorities' => [self::PRIORITY, $this->t('By priority'), $summary['priorities']],
      'parents' => [self::PARENT, $this->t('By parent'), $summary['parents']],
    ];
    $cells = [];
    foreach ($facets as $key => [$identifier, $heading, $rows]) {
      if ($rows === []) {
        continue;
      }
      $cells[$key] = $this->cell($heading, array_map(
        fn (array $row): array => $this->chip(
          $row['label'] . ' · ' . $row['count'],
          $row['value'] === NULL || $row['value'] === '!' ? NULL : $this->address()->toggle($identifier, $row['value']),
          $row['active'],
          title: $row['title'] ?? NULL,
          tone: $row['tone'] ?? NULL,
        ),
        $rows,
      ), 'row');
    }
    return $cells;
  }

  /**
   * One facet chip: a toggle link, highlighted when its value is active.
   *
   * @return array<string, mixed>
   *   A button render array; without a link it is disabled.
   */
  private function chip(
    string $label,
    ?string $href,
    bool $active,
    string $variant = 'neutral',
    ?string $title = NULL,
    ?string $tone = NULL,
  ): array {
    $props = $href === NULL ? ['label' => $label, 'disabled' => TRUE] : ['label' => $label, 'href' => $href];
    $chosen = $variant;
    $attrs = [];
    if ($variant !== 'ghost') {
      $attrs['aria-pressed'] = 'false';
      if ($active && $tone !== NULL && $tone !== '') {
        $props['tone'] = $tone;
        $attrs['aria-pressed'] = 'true';
      }
      elseif ($active) {
        $chosen = 'primary';
        $attrs['aria-pressed'] = 'true';
      }
      elseif (in_array($tone, ['critical', 'wait'], TRUE)) {
        $chosen = 'danger';
      }
    }
    if ($title !== NULL && $title !== '') {
      $attrs['title'] = $title;
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#variant' => $chosen,
      '#props' => $props,
      '#attributes' => $attrs,
    ];
  }

  /**
   * One labelled summary cell.
   *
   * @param \Drupal\Core\StringTranslation\TranslatableMarkup $heading
   *   The cell heading.
   * @param array<int, array<string, mixed>> $items
   *   The cell content.
   * @param string $direction
   *   Either `row` for wrapping chips or `column` for stacked text.
   *
   * @return array<string, mixed>
   *   A zone render array.
   */
  private function cell(TranslatableMarkup $heading, array $items, string $direction): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'none', 'gap' => 'sm', 'direction' => $direction],
      '#slots' => [
        'heading' => ['#plain_text' => (string) $heading],
        'content' => $items,
      ],
    ];
  }

}
