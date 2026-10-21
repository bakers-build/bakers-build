<?php

declare(strict_types=1);

namespace Drupal\Tests\bb_core\Kernel\Statistics;

use Drupal\bb_core\Statistics\FigureRenderer;
use Drupal\KernelTests\KernelTestBase;
use PHPUnit\Framework\Attributes\Group;

/**
 * Covers how the atomic figure payload maps onto SDC render arrays.
 */
#[Group('bb_core')]
final class FigureRendererTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   *
   * @var array<string>
   */
  protected static $modules = ['system', 'user', 'file', 'image', 'bb_core'];

  /**
   * A `line` figure with several series renders through the comparison chart.
   */
  public function testLineFiguresRenderThroughTheComparisonChart(): void {
    $figure = [
      'id' => 'user_models_trend',
      'label' => 'Token spend by model',
      'description' => '',
      'widget' => 'line',
      'generated' => gmdate('c'),
      'filters' => [],
      'categories' => [
        ['key' => '2026-09-19', 'label' => 'Sat 19'],
        ['key' => '2026-09-20', 'label' => 'Sun 20', 'partial' => TRUE],
      ],
      'measurements' => [
        [
          'id' => 'run_tokens:claude-opus-5',
          'label' => 'claude-opus-5',
          'value_type' => 'integer',
          'unit' => 'tokens',
          'values' => ['2026-09-19' => 5, '2026-09-20' => 6],
        ],
        [
          'id' => 'run_tokens:grok-4.6',
          'label' => 'grok-4.6',
          'value_type' => 'integer',
          'unit' => 'tokens',
          'values' => ['2026-09-19' => 2, '2026-09-20' => 3],
        ],
        [
          'id' => 'run_tokens:other',
          'label' => 'Other',
          'value_type' => 'integer',
          'unit' => 'tokens',
          'values' => ['2026-09-19' => 1, '2026-09-20' => 1],
        ],
      ],
      'empty' => ['is_empty' => FALSE, 'message' => NULL],
      'cache' => ['max_age' => 0, 'contexts' => [], 'tags' => []],
    ];

    $widgets = $this->renderWidgets($figure);
    self::assertArrayHasKey('chart', $widgets);
    self::assertArrayNotHasKey('run_tokens:claude-opus-5', $widgets);
    self::assertSame('bb_theme:stat-comparison', $widgets['chart']['#component']);
    $chart = $widgets['chart']['#props']['chart'];
    self::assertSame('ready', $chart['state']);
    self::assertCount(3, $chart['series']);
    self::assertSame(
      ['run_tokens:claude-opus-5', 'run_tokens:grok-4.6', 'run_tokens:other'],
      array_column($chart['series'], 'key'),
    );
    // Each series gets its own style slot, which is what the theme turns into
    // its own `chart-series-*` colour.
    self::assertSame(['a', 'b', 'c'], array_column($chart['series'], 'style'));
    self::assertSame(['Sat 19', 'Sun 20'], $chart['labels']);
    // Points are {x, y} objects rather than bare numbers, so a gap is never a
    // null array element — the Storybook SDC addon crashes on one.
    self::assertSame(
      [['x' => 'Sat 19', 'y' => 5.0], ['x' => 'Sun 20', 'y' => 6.0]],
      $chart['series'][0]['values'],
    );
    self::assertSame('6', $chart['series'][0]['latest_value']);
    // The exact-value table is `rows`, never `entries`: Twing's json_encode
    // duck-types a Map by calling `thing.entries()`.
    self::assertArrayNotHasKey('entries', $chart);
    self::assertSame(
      [['date' => 'Sat 19', 'values' => ['5', '2', '1']], ['date' => 'Sun 20', 'values' => ['6', '3', '1']]],
      $chart['rows'],
    );
  }

  /**
   * A chart spans the full content width instead of sharing a two-column zone.
   *
   * Seven daily buckets is exactly the default period, and it used to satisfy
   * the `<= 7` rule that halved the plot.
   */
  public function testLineFiguresGetTheFullContentWidth(): void {
    $categories = [];
    foreach (range(14, 20) as $day) {
      $categories[] = ['key' => '2026-09-' . $day, 'label' => (string) $day];
    }
    $figure = $this->lineFigure($categories, [
      [
        'id' => 'closed_tickets:cw',
        'label' => 'cw',
        'value_type' => 'integer',
        'unit' => 'tickets',
        'values' => array_fill_keys(array_column($categories, 'key'), 1),
      ],
    ]);

    $build = $this->renderFigure($figure);
    self::assertSame(1, $build['#slots']['content']['#props']['columns']);
  }

  /**
   * The period switch belongs to the page, so no figure carries one.
   */
  public function testFigureActionsCarryNoFilterControls(): void {
    $figure = $this->lineFigure([['key' => '2026-09-20', 'label' => 'Sun 20']], []);
    $figure['filters'] = [
      'period' => [
        'label' => 'Period',
        'value' => '7',
        'options' => [
          ['value' => '7', 'label' => '7 days'],
          ['value' => '30', 'label' => '30 days'],
        ],
      ],
    ];

    $build = $this->renderFigure($figure);
    self::assertSame('', $build['#slots']['actions'] ?? '');
  }

  /**
   * An empty line figure still uses the comparison chart, not the breakdown.
   */
  public function testEmptyLineFiguresStayOnTheComparisonChart(): void {
    $figure = [
      'id' => 'user_models_trend',
      'label' => 'Token spend by model',
      'description' => '',
      'widget' => 'line',
      'generated' => gmdate('c'),
      'filters' => [],
      'categories' => [],
      'measurements' => [],
      'empty' => ['is_empty' => TRUE, 'message' => 'No data for this selection.'],
      'cache' => ['max_age' => 0, 'contexts' => [], 'tags' => []],
    ];

    $widgets = $this->renderWidgets($figure);
    self::assertArrayHasKey('chart', $widgets);
    self::assertArrayNotHasKey('breakdown', $widgets);
    self::assertSame('bb_theme:stat-comparison', $widgets['chart']['#component']);
    self::assertSame('empty', $widgets['chart']['#props']['chart']['state']);
  }

  /**
   * An empty figure that HAS categories carries no exact-value table.
   *
   * The categories exist whether or not anything was measured in them, so the
   * rows would otherwise be one line of dashes per date rendered beside the
   * figure's own empty widget.
   */
  public function testEmptyLineFiguresCarryNoExactValueRows(): void {
    $figure = $this->lineFigure(
      [
        ['key' => '2026-09-01', 'label' => '1 Sep'],
        ['key' => '2026-09-02', 'label' => '2 Sep'],
      ],
      [
        [
          'id' => 'closed_tickets',
          'label' => 'Closed tickets',
          'values' => [],
          'total' => NULL,
        ],
      ],
    );
    $figure['empty'] = ['is_empty' => TRUE, 'message' => 'No data for this selection.'];

    $chart = $this->renderWidgets($figure)['chart']['#props']['chart'];
    self::assertSame('empty', $chart['state']);
    self::assertSame([], $chart['rows']);
  }

  /**
   * Builds one `line` figure payload around the supplied categories.
   *
   * @param array<int, array<string, mixed>> $categories
   *   The figure's categories.
   * @param array<int, array<string, mixed>> $measurements
   *   The figure's measurements.
   *
   * @return array<string, mixed>
   *   One evaluated figure payload.
   */
  private function lineFigure(array $categories, array $measurements): array {
    return [
      'id' => 'team_members_tickets_trend',
      'label' => 'Closed tickets by member over time',
      'description' => '',
      'widget' => 'line',
      'generated' => gmdate('c'),
      'filters' => [],
      'categories' => $categories,
      'measurements' => $measurements,
      'empty' => ['is_empty' => $measurements === [], 'message' => 'No data for this selection.'],
      'cache' => ['max_age' => 0, 'contexts' => [], 'tags' => []],
    ];
  }

  /**
   * Invokes the renderer's private figure build for one figure payload.
   *
   * @param array<string, mixed> $figure
   *   One evaluated figure payload.
   *
   * @return array<string, mixed>
   *   The figure render array.
   */
  private function renderFigure(array $figure): array {
    $renderer = $this->container->get('bb_core.figure_renderer');
    self::assertInstanceOf(FigureRenderer::class, $renderer);
    $method = new \ReflectionMethod($renderer, 'figure');
    return $method->invoke($renderer, $figure);
  }

  /**
   * Invokes the renderer's private widget mapping for one figure payload.
   *
   * @param array<string, mixed> $figure
   *   One evaluated figure payload.
   *
   * @return array<string, mixed>
   *   The mapped widget render arrays.
   */
  private function renderWidgets(array $figure): array {
    $renderer = $this->container->get('bb_core.figure_renderer');
    self::assertInstanceOf(FigureRenderer::class, $renderer);
    $method = new \ReflectionMethod($renderer, 'widget');
    return $method->invoke($renderer, $figure);
  }

}
