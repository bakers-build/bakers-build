<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\Url;
use Drupal\bb_core\Statistics\Figure\FigureCollection;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Renders the same grouped atomic figure payload exposed by the API.
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
  ) {}

  /**
   * Builds the grouped statistics render array.
   *
   * @param array<string, \Drupal\Core\Entity\EntityInterface> $contexts
   *   Named entity contexts.
   * @param \Drupal\Core\Session\AccountInterface $account
   *   The requesting account.
   * @param array<string, string> $filters
   *   Selected filter values.
   *
   * @return array<string, mixed>
   *   The statistics render array.
   */
  public function build(array $contexts, AccountInterface $account, array $filters = []): array {
    $groups = $this->collection->groups($contexts, $account, $filters, $this->time->getRequestTime());
    $content = [];
    // Every figure declares the same filters and FigureCollection applies a
    // selected value to all of them, so the control belongs to the page, not to
    // each figure. Built per figure it appeared once per card while still
    // changing the whole page — several identical switches for one effect.
    $controls = [];
    foreach ($groups as $group) {
      $figures = [];
      foreach ($group['figures'] as $figure) {
        $controls += $this->filters($figure);
        $figures[$figure['id']] = $this->figure($figure);
      }
      $content[$group['id']] = [
        '#type' => 'component',
        '#component' => 'bb_theme:zone',
        '#props' => ['inset' => 'none'],
        '#slots' => [
          'heading' => count($group['figures']) > 1 ? ['#plain_text' => $group['label']] : '',
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
      '#slots' => ['actions' => $controls ?: '', 'content' => $content],
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
   *
   * @return array<string, mixed>
   *   The figure render array.
   */
  private function figure(array $figure): array {
    $widgets = $this->widget($figure);
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
        'description' => $figure['description'],
        'attributes' => [
          'data-statistics-widget' => $figure['widget'],
          'data-statistics-figure' => $figure['id'],
        ],
      ],
      '#slots' => [
        'heading' => isset($widgets['breakdown']) ? '' : ['#plain_text' => $figure['label']],
        'content' => [
          '#type' => 'component',
          '#component' => 'bb_theme:zone',
          '#props' => [
            'inset' => 'none',
            // A chart spans the full content width; sharing a two-column
            // zone would halve the plot for the default seven-day period.
            'columns' => $this->isWindows($figure) ? 2 : 1,
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
      $options = [];
      foreach ($filter['options'] as $option) {
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
   * Builds a URL that changes one figure filter and retains request context.
   */
  private function filterUrl(string $key, string $value): Url {
    $request = $this->requestStack->getCurrentRequest();
    $query = $request?->query->all() ?? [];
    $query['filter'] = array_merge((array) ($query['filter'] ?? []), [$key => $value]);
    return Url::fromUserInput($request?->getPathInfo() ?? '/', ['query' => $query]);
  }

  /**
   * Maps the API payload to the same SDC contracts used by Storybook.
   */
  private function widget(array $figure): array {
    if ($this->isWindows($figure)) {
      return $this->windows($figure);
    }
    if ($figure['widget'] === 'line') {
      return ['chart' => $this->comparisonChart($figure)];
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
   * The totals components have a strict three-period contract.
   */
  private function isWindows(array $figure): bool {
    return $figure['widget'] === 'matrix'
      && array_column($figure['categories'], 'key') === ['day', 'week', 'month'];
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
