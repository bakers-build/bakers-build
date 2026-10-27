<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\Entity\BbProjectInterface;
use Drupal\bb_core\Statistics\Figure\FigureCollection;
use Drupal\bb_core\Statistics\Render\FigureFormat;
use Drupal\bb_core\Statistics\Render\FigureTable;
use Drupal\bb_core\Statistics\Render\InsightTiles;
use Drupal\bb_core\Statistics\Render\PeopleDirectory;
use Drupal\bb_core\Statistics\Render\TicketDirectory;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Renders the same grouped atomic figure payload exposed by the API.
 *
 * @SuppressWarnings("PHPMD.ExcessiveClassComplexity")
 */
final class FigureRenderer {

  use StringTranslationTrait;

  /**
   * The series style slots the theme carries `chart-series-*` tokens for.
   */
  private const SERIES_STYLES = ['a', 'b', 'c', 'd', 'e', 'f'];

  public function __construct(
    private readonly FigureCollection $collection,
    private readonly TimeInterface $time,
    private readonly RequestStack $requestStack,
    private readonly PeopleDirectory $people,
    private readonly TicketDirectory $tickets,
  ) {}

  /**
   * Builds the grouped statistics render array.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   Named entity contexts.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The requesting account.
   * @param array<string, string|list<string>> $filters
   *   Selected filter values.
   * @param array{controls?: bool, layout?: string, subtitles?: array<string, string>} $options
   *   `controls` FALSE leaves out the period buttons, for a page that places
   *   its own period range. `layout` `insights` drops the group heading and
   *   the figure descriptions (the tiles' info carries what is counted) and
   *   lays the tiles out in one row. `subtitles` puts a line under a figure's
   *   heading, keyed by figure id, in place of its description.
   *
   * @return array<string, mixed>
   *   The statistics render array.
   */
  public function build(array $contexts, AccountInterface $account, array $filters = [], array $options = []): array {
    $groups = $this->collection->groups($contexts, $account, $filters, $this->time->getRequestTime());
    $content = [];
    // Every figure declares the same filters and FigureCollection applies a
    // selected value to all of them, so the control belongs to the page, not to
    // each figure. Built per figure it appeared once per card while still
    // changing the whole page — several identical switches for one effect.
    $controls = [];
    $insights = ($options['layout'] ?? '') === 'insights';
    foreach ($groups as $group) {
      $figures = [];
      foreach ($group['figures'] as $figure) {
        $controls += $this->filters($figure);
        $figures[$figure['id']] = $this->figure($figure, $contexts, $insights ? 'insights' : '', $options['subtitles'][$figure['id']] ?? NULL);
      }
      $content[$group['id']] = [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'none'],
        '#slots' => [
          'heading' => count($group['figures']) > 1 && !$insights ? ['#plain_text' => $group['label']] : '',
          'content' => $figures,
        ],
      ];
    }
    if ($content === []) {
      $content['empty'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => ['message' => (string) $this->t('There are no statistics to show here.'), 'compact' => TRUE],
      ];
    }
    $build = [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => ['inset' => 'lg'],
      '#slots' => ['actions' => ($options['controls'] ?? TRUE) && $controls ? $controls : '', 'content' => $content],
    ];
    $metadata = (new CacheableMetadata())
      ->setCacheMaxAge(0)
      ->addCacheContexts(['user.permissions', 'url.query_args'])
      ->addCacheTags(['og_membership_list']);
    foreach ($contexts as $context) {
      $metadata->addCacheableDependency($context);
    }
    $metadata->applyTo($build);
    return $build;
  }

  /**
   * Builds one figure from the atomic payload.
   *
   * @param array<string, mixed> $figure
   *   One evaluated figure.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named contexts, for widgets that name the context's people.
   * @param string $layout
   *   The layout; `insights` leaves out the description line, which the
   *   tiles' info carries instead.
   * @param string|null $subtitle
   *   The line under the heading in place of the description, if any.
   *
   * @return array<string, mixed>
   *   The figure render array.
   */
  private function figure(array $figure, array $contexts = [], string $layout = '', ?string $subtitle = NULL): array {
    $widgets = $this->widget($figure, $contexts);
    if (($figure['empty']['is_empty'] ?? FALSE) && $figure['categories'] !== []) {
      $widgets['empty'] = [
        '#type' => 'component',
        '#component' => 'bb_theme:empty-state',
        '#props' => [
          'message' => $figure['empty']['message'] ?? (string) $this->t('No data for this selection.'),
          'compact' => TRUE,
        ],
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:zone',
      '#props' => [
        'inset' => 'none',
        'description' => $subtitle ?? ($layout === 'insights' ? '' : $figure['description']),
        'attributes' => [
          'data-statistics-widget' => $figure['widget'],
          'data-statistics-figure' => $figure['id'],
        ],
      ],
      '#slots' => [
        // The breakdown and the flow chart carry their own heading; tiles name
        // themselves.
        'heading' => isset($widgets['breakdown']) || in_array($figure['widget'], ['flow', 'tiles'], TRUE) ? '' : ['#plain_text' => $figure['label']],
        'content' => [
          '#type' => 'component',
          '#component' => 'bb_theme:zone',
          '#props' => [
            'inset' => 'none',
            // A chart spans the full content width; sharing a two-column
            // zone would halve the plot for the default seven-day period.
            'columns' => $figure['widget'] === 'tiles' ? 4 : ($this->isWindows($figure) ? 2 : 1),
          ],
          '#slots' => ['content' => $widgets],
        ],
      ],
    ];
  }

  /**
   * Builds the filter controls for one figure.
   */
  private function filters(array $figure): array {
    $filters = [];
    foreach ($figure['filters'] as $key => $filter) {
      // Entity filters select from popovers the page places, not buttons.
      if (($filter['type'] ?? '') === 'entities') {
        continue;
      }
      $options = [];
      foreach ($filter['options'] as $option) {
        // A button cannot supply the two dates a custom range needs; the
        // period-range component offers Custom where it is placed.
        if ($key === 'period' && $option['value'] === 'custom') {
          continue;
        }
        $attributes = [
          'data-filter-name' => $key,
          'data-filter-value' => $option['value'],
        ];
        if ($option['value'] === $filter['value']) {
          $attributes['aria-current'] = 'true';
        }
        $options[] = [
          '#type' => 'component',
          '#component' => 'bb_theme:button',
          '#props' => [
            'label' => $option['label'],
            'href' => $this->filterUrl($key, $option['value'])->toString(),
            'variant' => $option['value'] === $filter['value'] ? 'primary' : 'ghost',
            'attributes' => $attributes,
          ],
        ];
      }
      $filters[$key] = [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'none', 'direction' => 'row', 'gap' => 'sm', 'description' => $filter['label']],
        '#slots' => ['content' => $options],
      ];
    }
    return $filters;
  }

  /**
   * The request query the page's own links carry forward.
   *
   * An htmx request adds its asset state and wrapper format; a copied link
   * carrying them would load a page that believes its CSS and JS are present.
   *
   * @return array<string, mixed>
   *   The query without htmx request parameters.
   */
  private function query(): array {
    $query = $this->requestStack->getCurrentRequest()?->query->all() ?? [];
    unset($query['ajax_page_state'], $query['_wrapper_format'], $query['_triggering_element_name'], $query['_triggering_element_value']);
    return $query;
  }

  /**
   * Builds a URL that changes one figure filter and retains request context.
   */
  private function filterUrl(string $key, string $value): Url {
    $request = $this->requestStack->getCurrentRequest();
    $query = $this->query();
    $query['filter'] = array_merge((array) ($query['filter'] ?? []), [$key => $value]);
    return Url::fromUserInput($request?->getPathInfo() ?? '/', ['query' => $query]);
  }

  /**
   * Maps the API payload to the same SDC contracts used by Storybook.
   *
   * @param array<string, mixed> $figure
   *   One evaluated figure.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named contexts.
   *
   * @return array<string, mixed>
   *   The widget render arrays.
   */
  private function widget(array $figure, array $contexts = []): array {
    if ($this->isWindows($figure)) {
      return $this->windows($figure);
    }
    if ($figure['widget'] === 'tiles') {
      return InsightTiles::build($figure, self::inflow($figure));
    }
    if ($figure['widget'] === 'table') {
      return $this->table($figure, $contexts);
    }
    if ($figure['widget'] === 'bars') {
      // Without any value the figure's own empty state says so; zero rows
      // beside it would contradict it.
      $values = $figure['measurements'][0]['values'] ?? [];
      return array_sum(array_filter($values, static fn($value): bool => $value !== NULL)) > 0 ? ['breakdown' => $this->bars($figure)] : [];
    }
    if (array_column($figure['categories'], 'key') === ['total']) {
      return $this->tiles($figure);
    }
    if ($figure['widget'] === 'line') {
      return ['chart' => $this->comparisonChart($figure)];
    }
    if ($figure['widget'] === 'flow') {
      return ['chart' => $this->flowChart($figure)];
    }
    return ['breakdown' => $this->breakdown($figure)];
  }

  /**
   * Maps a `line` figure's categories and measurements onto a comparison chart.
   *
   * The component is a Chart.js island: it receives the values and the labels
   * and draws them itself. No geometry is computed here — no domains, no pixel
   * positions, no path commands — because the browser knows the real width the
   * canvas ends up with and this renderer does not.
   *
   * @param array<string, mixed> $figure
   *   One evaluated figure.
   *
   * @return array<string, mixed>
   *   The `bb_theme:stat-comparison` render array.
   */
  private function comparisonChart(array $figure): array {
    $labels = array_column($figure['categories'], 'label');
    $keys = array_column($figure['categories'], 'key');
    $series = [];
    $rows = [];
    $hasValue = FALSE;
    foreach ($figure['measurements'] as $index => $measurement) {
      $values = [];
      $latest = NULL;
      foreach ($keys as $position => $key) {
        $value = $measurement['values'][$key] ?? NULL;
        // A point is an {x, y} object rather than a bare number, and a gap is
        // `y: null` rather than a null array element. The Storybook SDC addon
        // walks every array prop and reads `.type` off each element, so a bare
        // null in a story's values array crashes the story loader outright.
        $values[] = ['x' => $labels[$position], 'y' => $value === NULL ? NULL : (float) $value];
        if ($value !== NULL) {
          $hasValue = TRUE;
          $latest = (string) $value;
        }
      }
      $series[] = [
        'key' => $measurement['id'],
        'style' => self::SERIES_STYLES[$index % count(self::SERIES_STYLES)],
        'label' => $measurement['label'],
        'latest_value' => $latest,
        'values' => $values,
      ];
    }
    foreach ($keys as $position => $key) {
      $rows[] = [
        'date' => $labels[$position],
        'values' => array_map(
          static function (array $measurement) use ($key): string {
            $value = $measurement['values'][$key] ?? NULL;
            return $value === NULL ? '—' : (string) $value;
          },
          $figure['measurements'],
        ),
      ];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:stat-comparison',
      '#props' => [
        'chart' => [
          'state' => $hasValue ? 'ready' : 'empty',
          'label' => $figure['label'],
          'value_label' => (string) $this->t('Value'),
          'labels' => $labels,
          'series' => $series,
          // `rows`, not `entries`: Twing's json_encode duck-types a Map by
          // calling `thing.entries()`, so that key name breaks every Storybook
          // story of this component.
          //
          // An empty figure carries no table. Categories exist even when every
          // value is NULL, so building the rows unconditionally would render an
          // "Exact values" list of dashes beside the figure's own empty widget.
          'rows' => $hasValue ? $rows : [],
        ],
      ],
    ];
  }

  /**
   * Maps a `flow` figure's new, done and open measurements onto a flow chart.
   *
   * The measurements are positional — new, done, open — as BbFigure enforces.
   * Only formatting happens here; the chart draws and the evaluator counts.
   *
   * @param array<string, mixed> $figure
   *   One evaluated figure.
   *
   * @return array<string, mixed>
   *   The `bb_theme:flow-chart` render array.
   */
  private function flowChart(array $figure): array {
    [$new, $done, $open] = $figure['measurements'] + [[], [], []];
    $sections = [];
    $running = NULL;
    foreach ($figure['categories'] as $category) {
      $key = $category['key'];
      $sections[] = [
        'label' => $category['label'],
        'new' => $new['values'][$key] ?? 0,
        'done' => $done['values'][$key] ?? 0,
        'open' => $open['values'][$key] ?? NULL,
        'running' => !empty($category['partial']),
        'cut' => !empty($category['cut']),
      ];
      if (!empty($category['partial'])) {
        $running = $category['label'];
      }
    }
    // Monthly buckets are keyed `Y-m`, daily ones `Y-m-d`.
    $monthly = preg_match('/^\d{4}-\d{2}$/', (string) ($figure['categories'][0]['key'] ?? '')) === 1;
    $caption = $monthly ? (string) $this->t('Per month, UTC') : (string) $this->t('Per day, UTC');
    if ($running !== NULL) {
      $caption .= ' · ' . $this->t('@section is still running', ['@section' => $running]);
    }
    $ratio = $figure['ratio'] ?? NULL;
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:flow-chart',
      '#props' => [
        'chart' => [
          'state' => ($figure['empty']['is_empty'] ?? FALSE) ? 'empty' : 'ready',
          'label' => $figure['label'],
          'caption' => $caption,
          'ratio' => $ratio === NULL ? NULL : (string) $ratio,
          'ratio_label' => (string) $this->t('done : new'),
          'totals' => ['new' => (string) ($new['total'] ?? 0), 'done' => (string) ($done['total'] ?? 0)],
          'open_at' => $running === NULL ? NULL : gmdate('H:i', (int) strtotime($figure['generated'])) . ' UTC',
          'sections' => $sections,
        ],
      ],
    ];
  }

  /**
   * Maps three-period measurements to totals components.
   */
  private function windows(array $figure): array {
    $widgets = [];
    foreach ($figure['measurements'] as $measurement) {
      $windows = [];
      foreach ($figure['categories'] as $category) {
        $value = $measurement['values'][$category['key']] ?? NULL;
        $windows[] = ['label' => $category['label'], 'value' => $value === NULL ? '—' : (string) $value];
      }
      $ratio = $measurement['unit'] === 'runs_per_ticket';
      $widgets[$measurement['id']] = [
        '#type' => 'component',
        '#component' => $ratio ? 'bb_theme:stat-ratio' : 'bb_theme:stat-windows',
        '#props' => ['label' => $measurement['label'], $ratio ? 'quotients' : 'windows' => $windows],
      ];
    }
    return $widgets;
  }

  /**
   * Maps a total figure to one tile per measurement with its comparison.
   *
   * @param array<string, mixed> $figure
   *   One evaluated `total` figure.
   *
   * @return array<string, array<string, mixed>>
   *   The `bb_theme:stat-tile` render arrays keyed by measurement id.
   */
  private function tiles(array $figure): array {
    $tiles = [];
    foreach ($figure['measurements'] as $measurement) {
      $value = $measurement['values']['total'] ?? NULL;
      $props = [
        'value' => $value === NULL ? '—' : (string) $value,
        'label' => $measurement['label'],
        'source' => 'bb_measurement.' . strstr($measurement['id'] . ':', ':', TRUE),
        'window' => $figure['period']['label'] ?? '',
      ];
      $comparison = $measurement['comparison'] ?? NULL;
      if (is_array($comparison)) {
        $previous = $comparison['values']['total'] ?? NULL;
        $props['comparison'] = [
          'value' => $previous === NULL ? '—' : (string) $previous,
          'label' => (string) $this->t('vs. @period', ['@period' => $comparison['labels']['total'] ?? '']),
        ] + FigureFormat::percentChange($value, $previous);
      }
      $tiles[$measurement['id']] = [
        '#type' => 'component',
        '#component' => 'bb_theme:stat-tile',
        '#props' => $props,
      ];
    }
    return $tiles;
  }

  /**
   * The totals components have a strict three-period contract.
   */
  private function isWindows(array $figure): bool {
    return $figure['widget'] === 'matrix'
      && array_column($figure['categories'], 'key') === ['day', 'week', 'month'];
  }

  /**
   * Maps a `bars` figure onto share bars: each entry's part of the whole.
   *
   * @param array<string, mixed> $figure
   *   One evaluated `bars` figure.
   *
   * @return array<string, mixed>
   *   The `bb_theme:stat-breakdown` render array.
   */
  private function bars(array $figure): array {
    $measurement = $figure['measurements'][0] ?? ['id' => '', 'label' => '', 'values' => []];
    $total = array_sum(array_filter($measurement['values'], static fn($value): bool => $value !== NULL));
    $entries = [];
    foreach ($figure['categories'] as $category) {
      $value = $measurement['values'][$category['key']] ?? 0;
      $share = $total > 0 ? round($value / $total * 100) : 0.0;
      $entries[] = [
        'label' => $category['label'],
        'value' => FigureFormat::abbreviate($value),
        'share' => (float) $share,
        'share_label' => (int) $share . ' %',
        'counts' => [$measurement['id'] => FigureFormat::abbreviate($value)],
      ] + ($measurement['id'] === 'run_tokens' ? ['exact' => FigureFormat::exactTokens($value)] : []);
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:stat-breakdown',
      '#props' => [
        'label' => $figure['label'],
        'caption' => (string) $this->t('Tokens, @period. Not a billable quantity.', ['@period' => $figure['period']['label'] ?? '']),
        'display' => 'bars',
        'columns' => [['key' => $measurement['id'], 'label' => $measurement['label']]],
        'entries' => $entries,
        'empty' => $figure['empty']['message'] ?? (string) $this->t('No data for this selection.'),
      ],
    ];
  }

  /**
   * Maps a `table` figure onto a sortable, paged table with its footnotes.
   *
   * @param array<string, mixed> $figure
   *   One evaluated `table` figure.
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named contexts; the workspace, or the project's, names the people's
   *   teams.
   *
   * @return array<string, mixed>
   *   The table, pager and footnote render arrays.
   */
  private function table(array $figure, array $contexts): array {
    $people = ($figure['categories'][0]['key'] ?? '') !== '' && str_ends_with((string) $figure['id'], '_people');
    $built = $this->tableOf($figure, $people, $this->peopleWorkspace($contexts));
    $widgets = [
      'table' => ['#type' => 'component', '#component' => 'bb_theme:table', '#props' => $built['table']],
    ];
    if ($built['pager'] !== NULL) {
      $widgets['pager'] = [
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
    $footnotes = $built['footnotes'];
    if ($people) {
      $footnotes[] = (string) $this->t('Values belong to the current assignee.');
    }
    if ($footnotes !== []) {
      $lead = implode(' ', array_map(static fn(string $note): string => rtrim($note, '.') . '.', $footnotes));
      $widgets['footnotes'] = ['#type' => 'component', '#component' => 'bb_theme:note', '#props' => ['lead' => $lead]];
    }
    return $widgets;
  }

  /**
   * The workspace whose teams name the people: the context's, or the project's.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   The named contexts.
   */
  private function peopleWorkspace(array $contexts): ?EntityInterface {
    $project = $contexts['project'] ?? NULL;
    return $contexts['workspace'] ?? ($project instanceof BbProjectInterface ? $project->getGroup()?->getWorkspace() : NULL);
  }

  /**
   * What a tiles figure calls its created tickets: one's own are assigned.
   */
  private static function inflow(array $figure): string {
    return str_starts_with((string) $figure['id'], 'user_') ? 'assigned' : 'created';
  }

  /**
   * The sortable, paged table description for one `table` figure.
   *
   * @param array<string, mixed> $figure
   *   One evaluated `table` figure.
   * @param bool $people
   *   Whether the rows are people.
   * @param \Drupal\Core\Entity\EntityInterface|null $workspace
   *   The workspace whose teams name the people.
   *
   * @return array<string, mixed>
   *   The FigureTable result.
   */
  private function tableOf(array $figure, bool $people, ?EntityInterface $workspace): array {
    if ($figure['id'] === 'user_tickets') {
      // Runs and tokens also group tickets that did not close in the period.
      $closed = array_column($figure['measurements'], 'values', 'id')['closed_tickets'] ?? [];
      $figure['categories'] = array_values(array_filter($figure['categories'], static fn(array $category): bool => ($closed[$category['key']] ?? 0) > 0));
      return FigureTable::build($figure, FigureTable::ticketColumns(), $this->query(), NULL, 'tickets', $this->tickets->cells(array_column($figure['categories'], 'key')), 'tokens', 'desc');
    }
    if ($people) {
      $cells = $workspace === NULL ? [] : $this->people->cells($workspace, array_column($figure['categories'], 'key'));
      return FigureTable::build($figure, FigureTable::peopleColumns(), $this->query(), NULL, 'people', $cells);
    }
    if ($figure['id'] === 'user_projects') {
      return FigureTable::build($figure, FigureTable::myProjectColumns(), $this->query(), NULL, 'projects');
    }
    return FigureTable::build($figure, FigureTable::projectColumns(), $this->query(), (string) $this->t('All projects'), 'projects');
  }

  /**
   * A pager button; without a target it is disabled, not a dead link.
   */
  private function pagerButton(string $label, ?string $url): array {
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:button',
      '#props' => $url === NULL ? ['label' => $label, 'disabled' => TRUE] : ['label' => $label, 'href' => $url],
    ];
  }

  /**
   * Keeps every category and measurement, including null and decimal values.
   */
  private function breakdown(array $figure): array {
    $columns = [];
    foreach ($figure['measurements'] as $measurement) {
      $columns[] = ['key' => $measurement['id'], 'label' => $measurement['label']];
    }
    $entries = [];
    foreach ($figure['categories'] as $category) {
      $counts = [];
      foreach ($figure['measurements'] as $measurement) {
        $value = $measurement['values'][$category['key']] ?? NULL;
        $counts[$measurement['id']] = $value === NULL ? '—' : (string) $value;
      }
      $entries[] = ['label' => $category['label'], 'counts' => $counts];
    }
    return [
      '#type' => 'component',
      '#component' => 'bb_theme:stat-breakdown',
      '#props' => [
        'label' => $figure['label'],
        'columns' => $columns,
        'entries' => $entries,
        'empty' => $figure['empty']['message'] ?? (string) $this->t('No data for this selection.'),
      ],
    ];
  }

}
