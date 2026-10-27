<?php

declare(strict_types=1);

namespace Drupal\bb_track\Statistics;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityRepositoryInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbWorkspaceInterface;
use Drupal\bb_core\Statistics\InsightsFilterOptions;
use Drupal\bb_core\Statistics\Period\PeriodRange;
use Drupal\bb_core\Statistics\Period\PeriodResolver;
use Drupal\bb_core\Statistics\Render\FigureFormat;
use Drupal\bb_track\Entity\Account;
use Drupal\bb_track\Form\BillingReportFilterForm;
use Symfony\Component\HttpFoundation\Request;

/**
 * The workspace Insights › Billing report page: controls, tiles, tree table.
 */
final class BillingReportPage {

  use StringTranslationTrait;

  /**
   * The page region a filter tick replaces.
   */
  public const REGION_ID = 'billing-report';

  /**
   * The entity filters and the entity type each one selects.
   */
  public const ENTITY_FILTERS = ['account' => 'bb_track_account', 'project' => 'bb_project'];

  /**
   * Query keys the page's own links carry; htmx's parameters never do.
   */
  private const QUERY_KEYS = ['filter', 'group', 'open', 'sort', 'order', 'page'];

  public function __construct(
    private readonly BillingReport $report,
    private readonly InsightsFilterOptions $options,
    private readonly EntityRepositoryInterface $entityRepository,
    private readonly TimeInterface $time,
    private readonly FormBuilderInterface $formBuilder,
  ) {}

  /**
   * Builds the page for one workspace.
   *
   * @return array<string, mixed>
   *   The page render array.
   */
  public function build(BbWorkspaceInterface $workspace, Request $request): array {
    $query = array_intersect_key($request->query->all(), array_flip(self::QUERY_KEYS));
    $group = ($query['group'] ?? '') === 'person' ? 'person' : 'account';
    $accepted = $this->accepted($request, $workspace);
    $filters = array_map(static fn(array $entities): array => array_map(static fn(EntityInterface $entity): string => (string) $entity->uuid(), $entities), $accepted['entities']) + $accepted['period'];
    $period = $this->options->period($workspace, $accepted['period']);
    $ids = array_map(static fn(array $entities): array => array_map(static fn(EntityInterface $entity): int => (int) $entity->id(), $entities), $accepted['entities']);
    $nodes = $this->report->build($workspace, $period, $ids, $group);
    $build = [
      '#type' => 'container',
      '#attributes' => ['data-bakers-tab-body' => 'insights'],
      'controls' => $this->controls($workspace, $period, $filters, $group, $query, $ids === [] ? $nodes : NULL),
      'note' => [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'lg'],
        '#slots' => [
          'content' => [
            '#type' => 'component',
            '#component' => 'bb_theme:note',
            '#slots' => [
              'body' => ['#plain_text' => (string) $this->t('Hours come from bakers.build time tracking: recorded and approved worklogs; proposed time is excluded. AI tokens are usage for context — they never set a billable quantity. No prices or costs are shown here.')],
            ],
          ],
        ],
      ],
      'content' => [
        '#type' => 'container',
        // No htmx history snapshot: Back after a tick refetches the page.
        '#attributes' => ['id' => self::REGION_ID, 'data-hx-history' => 'false'],
        'report' => $nodes === [] ? $this->empty($workspace, $period) : $this->report($nodes, $group, $query, $period),
      ],
    ];
    (new CacheableMetadata())
      ->setCacheMaxAge(0)
      ->addCacheContexts(['user.permissions', 'url.query_args'])
      ->addCacheableDependency($workspace)
      ->applyTo($build);
    return $build;
  }

  /**
   * The request's period values and the filter entities of this workspace.
   *
   * Filter values arrive from the request: a UUID that is unknown or lies in
   * another workspace is dropped, never an error.
   *
   * @return array{period: array<string, string>, entities: array<string, list<\Drupal\Core\Entity\EntityInterface>>}
   *   Period values and accepted entities by filter key.
   */
  private function accepted(Request $request, BbWorkspaceInterface $workspace): array {
    $accepted = ['period' => [], 'entities' => []];
    foreach ($request->query->all('filter') as $key => $value) {
      if (isset(self::ENTITY_FILTERS[$key]) && is_array($value)) {
        $entities = $this->acceptedEntities(self::ENTITY_FILTERS[$key], $value, $workspace);
        if ($entities !== []) {
          $accepted['entities'][$key] = $entities;
        }
      }
      elseif (in_array($key, ['period', ...PeriodResolver::COMPANIONS], TRUE) && is_string($value) && $value !== '') {
        $accepted['period'][$key] = $value;
      }
    }
    return $accepted;
  }

  /**
   * The entities of one filter that exist and lie in the workspace.
   *
   * @param string $type
   *   The entity type the filter selects.
   * @param array<mixed> $uuids
   *   The requested values.
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   *
   * @return list<\Drupal\Core\Entity\EntityInterface>
   *   The accepted entities.
   */
  private function acceptedEntities(string $type, array $uuids, BbWorkspaceInterface $workspace): array {
    $entities = [];
    foreach (array_filter($uuids, 'is_string') as $uuid) {
      $entity = $this->entityRepository->loadEntityByUuid($type, $uuid);
      if ($entity !== NULL && $this->inWorkspace($entity, $workspace)) {
        $entities[] = $entity;
      }
    }
    return $entities;
  }

  /**
   * Whether a project, or an account's project, lies in the workspace.
   */
  private function inWorkspace(EntityInterface $entity, BbWorkspaceInterface $workspace): bool {
    $project = $entity instanceof Account ? $entity->get('project_id')->entity : $entity;
    $group = $project instanceof ContentEntityInterface ? $project->get('group_id')->entity : NULL;
    return $group instanceof ContentEntityInterface && (int) $group->get('workspace_id')->target_id === (int) $workspace->id();
  }

  /**
   * Period range, grouping, Account and Project filters, Clear filters.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The resolved period.
   * @param array<string, string|list<string>> $filters
   *   The accepted filters, entities as UUIDs.
   * @param string $group
   *   Either `account` or `person`.
   * @param array<string, mixed> $query
   *   The page query.
   * @param list<array<string, mixed>>|null $unfiltered
   *   The page's report when no entity filter narrows it, NULL otherwise.
   *
   * @return array<string, mixed>
   *   The controls render array.
   */
  private function controls(BbWorkspaceInterface $workspace, PeriodRange $period, array $filters, string $group, array $query, ?array $unfiltered): array {
    $props = [
      'kind' => $period->kind,
      'date' => $period->start,
      'today' => gmdate('Y-m-d', $this->time->getRequestTime()),
      'name' => 'filter',
      'action' => $this->url($workspace),
    ];
    if ($period->kind === 'custom') {
      $props += ['start' => $period->start, 'end' => $period->end];
    }
    // A GET form replaces the action's query, so the filters and the
    // grouping ride along as hidden inputs.
    foreach (array_intersect_key($filters, self::ENTITY_FILTERS) as $key => $uuids) {
      foreach ((array) $uuids as $uuid) {
        $props['params'][] = ['name' => 'filter[' . $key . '][]', 'value' => $uuid];
      }
    }
    if ($group === 'person') {
      $props['params'][] = ['name' => 'group', 'value' => 'person'];
    }
    $options = $this->report->options($workspace, $period, $unfiltered);
    $entries = array_map(static fn(array $entities): array => array_map(static fn(EntityInterface $entity): array => [
      'value' => (string) $entity->uuid(),
      'label' => (string) $entity->label(),
    ], $entities), $options);
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'lg', 'direction' => 'row', 'gap' => 'sm'],
      '#slots' => [
        'content' => [
          'period' => [
            '#type' => 'container',
            '#attributes' => ['id' => 'insights-period'],
            'range' => ['#type' => 'component', '#component' => 'bb_theme:period-range', '#props' => $props],
          ],
          'group' => [
            '#type' => 'container',
            '#attributes' => ['id' => 'billing-group'],
            'switch' => $this->groupSwitch($workspace, $group, $query),
          ],
          'filters' => $this->formBuilder->getForm(BillingReportFilterForm::class, $workspace, $filters, $entries, $group),
          // Present even when empty, so the first tick has a target to fill.
          'clear' => ['#type' => 'container', '#attributes' => ['id' => 'insights-clear']] + $this->clearLink($workspace, $filters, $group),
        ],
      ],
    ];
  }

  /**
   * The By account | By person switch, keeping period and filters.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param string $group
   *   The current grouping.
   * @param array<string, mixed> $query
   *   The page query.
   *
   * @return array<string, mixed>
   *   The `bb_theme:segmented_control` render array.
   */
  private function groupSwitch(BbWorkspaceInterface $workspace, string $group, array $query): array {
    // Expanded rows and the page belong to one grouping's rows.
    unset($query['group'], $query['open'], $query['page']);
    $items = [];
    foreach (['account' => $this->t('By account'), 'person' => $this->t('By person')] as $value => $label) {
      $items[] = [
        'label' => (string) $label,
        'url' => $this->url($workspace, $value === 'person' ? ['group' => 'person'] + $query : $query),
        'active' => $value === $group,
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:segmented_control',
      '#props' => ['label' => (string) $this->t('Group'), 'items' => $items],
    ];
  }

  /**
   * The Clear filters link, keeping period and grouping, when one is set.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param array<string, string|list<string>> $filters
   *   The accepted filters.
   * @param string $group
   *   The grouping.
   *
   * @return array<string, array<string, mixed>>
   *   The link render array keyed `link`, or nothing.
   */
  private function clearLink(BbWorkspaceInterface $workspace, array $filters, string $group): array {
    if (array_intersect_key($filters, self::ENTITY_FILTERS) === []) {
      return [];
    }
    $period = array_diff_key($filters, self::ENTITY_FILTERS);
    $query = ($period === [] ? [] : ['filter' => $period]) + ($group === 'person' ? ['group' => 'person'] : []);
    return [
      'link' => [
        '#type' => 'component',
        '#component' => 'bb_theme:button',
        '#props' => [
          'label' => (string) $this->t('Clear filters'),
          'href' => $this->url($workspace, $query),
          'variant' => 'ghost',
        ],
      ],
    ];
  }

  /**
   * The tiles, the tree table and its pager.
   *
   * @param list<array<string, mixed>> $nodes
   *   The top-level nodes.
   * @param string $group
   *   The grouping.
   * @param array<string, mixed> $query
   *   The page query.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The period the tiles cover.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function report(array $nodes, string $group, array $query, PeriodRange $period): array {
    $built = BillingReportTable::build($nodes, $group, $query);
    $table = ['table' => ['#type' => 'component', '#component' => 'bb_theme:table', '#props' => $built['table']]];
    if ($built['pager'] !== NULL) {
      $table['pager'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'none', 'direction' => 'row', 'gap' => 'sm', 'align' => 'center'],
        '#slots' => [
          'content' => [
            [
              '#type' => 'component',
              '#component' => 'bb_theme:collection-position',
              '#props' => $built['pager']['position'],
            ],
            $this->pagerButton((string) $this->t('Previous'), $built['pager']['previous']),
            $this->pagerButton((string) $this->t('Next'), $built['pager']['next']),
          ],
        ],
      ];
    }
    return [
      'tiles' => [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'lg', 'direction' => 'row', 'gap' => 'md'],
        '#slots' => ['content' => $this->tiles($nodes, $period)],
      ],
      'table' => [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'lg', 'gap' => 'sm'],
        '#slots' => [
          'heading' => ['#plain_text' => (string) $this->t('Billing report')],
          'content' => $table,
        ],
      ],
    ];
  }

  /**
   * The Hours, Accounts and AI tokens tiles over every row.
   *
   * @param list<array<string, mixed>> $nodes
   *   The top-level nodes.
   * @param \Drupal\bb_core\Statistics\Period\PeriodRange $period
   *   The period the tiles cover.
   *
   * @return list<array<string, mixed>>
   *   The `bb_theme:stat-tile` render arrays.
   */
  private function tiles(array $nodes, PeriodRange $period): array {
    $sum = static fn(string $key): int => (int) array_sum(array_column($nodes, $key));
    $found = ['account' => [], 'project' => []];
    $walk = static function (array $nodes) use (&$walk, &$found): void {
      foreach ($nodes as $node) {
        if (isset($found[$node['kind']])) {
          $found[$node['kind']][$node['entity']->id()] = TRUE;
        }
        $walk($node['children']);
      }
    };
    $walk($nodes);
    $tokens = $sum('tokens');
    $tile = static fn(array $props): array => [
      '#type' => 'component',
      '#component' => 'bb_theme:stat-tile',
      '#props' => $props + ['window' => $period->label],
    ];
    return [
      $tile([
        'source' => 'bb_track_worklog.duration_seconds',
        'value' => BillingReportTable::hours($sum('hours')),
        'label' => (string) $this->t('Hours'),
        'detail' => (string) $this->t('@approved approved · @recorded recorded', [
          '@approved' => BillingReportTable::hours($sum('approved')),
          '@recorded' => BillingReportTable::hours($sum('recorded')),
        ]),
      ]),
      $tile([
        'source' => 'bb_track_account',
        'value' => (string) count($found['account']),
        'label' => (string) $this->t('Accounts'),
        'detail' => (string) $this->formatPlural(count($found['project']), 'across 1 project', 'across @count projects'),
      ]),
      $tile([
        'source' => 'bb_run.tokens',
        'value' => FigureFormat::abbreviate($tokens),
        'label' => (string) $this->t('AI tokens'),
        'exact' => FigureFormat::exactTokens($tokens),
        'detail' => (string) $this->t('usage, not billed'),
      ]),
    ];
  }

  /**
   * The explained empty state that replaces tiles and table.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private function empty(BbWorkspaceInterface $workspace, PeriodRange $period): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => [
        'inset' => 'lg',
        'description' => (string) $this->t('The billing report counts recorded and approved worklogs and the AI tokens of runs in @workspace. Nothing was recorded in this period.', ['@workspace' => $workspace->label()]),
      ],
      '#slots' => [
        'heading' => ['#plain_text' => (string) $this->t('No billable time or tokens in @period', ['@period' => $period->label])],
      ],
    ];
  }

  /**
   * A pager button; without a target it is disabled, not a dead link.
   *
   * @return array<string, mixed>
   *   The `bb_theme:button` render array.
   */
  private function pagerButton(string $label, ?string $url): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => $url === NULL ? ['label' => $label, 'disabled' => TRUE] : ['label' => $label, 'href' => $url],
    ];
  }

  /**
   * This workspace's Billing report path with a query.
   *
   * @param \Drupal\bb_core\Entity\BbWorkspaceInterface $workspace
   *   The workspace.
   * @param array<string, mixed> $query
   *   The query.
   */
  private function url(BbWorkspaceInterface $workspace, array $query = []): string {
    return Url::fromRoute('bb_track.workspace.insights_billing', ['bb_workspace' => $workspace->get('slug')->value], ['query' => $query])->toString();
  }

}
