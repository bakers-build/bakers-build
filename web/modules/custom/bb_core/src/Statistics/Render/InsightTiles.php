<?php

declare(strict_types=1);

namespace Drupal\bb_core\Statistics\Render;

/**
 * Builds the four Insights answer-strip tiles from a `tiles` figure.
 *
 * Counts and sums compare in percent, ratios and means compare absolutely.
 * A ratio or mean resting on fewer than five tickets is withheld as "—" with
 * its sample size, and never compared.
 */
final class InsightTiles {

  /**
   * Builds the tiles, keyed by the measurement each one leads with.
   *
   * @param array<string, mixed> $figure
   *   One evaluated `tiles` figure.
   * @param string $inflow
   *   What the created tickets are called: `assigned` on one account's own
   *   figures.
   *
   * @return array<string, array<string, mixed>>
   *   `bb_theme:stat-tile` render arrays.
   */
  public static function build(array $figure, string $inflow = 'created'): array {
    $byId = array_column($figure['measurements'], NULL, 'id');
    $current = static fn(string $id): int|float|null => $byId[$id]['values']['total'] ?? NULL;
    $previous = static fn(string $id): int|float|null => is_array($byId[$id]['comparison'] ?? NULL) ? ($byId[$id]['comparison']['values']['total'] ?? NULL) : NULL;
    $compared = is_array($byId['closed_tickets']['comparison'] ?? NULL);
    // A previous mean or ratio on a small sample is not worth comparing to.
    $previousSampled = static fn(string $sample, string $id): int|float|null => $compared && ($previous($sample) ?? 0) >= FigureFormat::MIN_SAMPLE ? $previous($id) : NULL;
    $closed = (int) ($current('closed_tickets') ?? 0);

    $tiles = [];
    $tiles['closed_tickets'] = self::tile([
      'value' => (string) $closed,
      'unit' => 'closed',
      'label' => 'Throughput',
      'source' => 'bb_measurement.closed_tickets',
      'info' => 'Tickets closed in the period (done or cancelled), by their closed date (UTC).',
      'detail' => self::backlog((int) ($current('created_tickets') ?? 0), $closed, $inflow),
    ], $compared ? self::percent($current('closed_tickets'), $previous('closed_tickets'), (string) ($previous('closed_tickets') ?? '—')) : NULL);

    $tiles['runs_per_ticket'] = self::sampled(
      $closed,
      'closed tickets',
      self::ratio($current('runs'), $current('closed_tickets')),
      self::ratio($previousSampled('closed_tickets', 'runs'), $previous('closed_tickets')),
      [
        'unit' => 'closed tickets',
        'label' => 'Runs per ticket',
        'source' => 'bb_measurement.runs_per_ticket',
        'info' => 'Runs started in the period per ticket closed in it.',
        'detail' => $closed > 0 ? (int) round(((int) ($current('closed_tickets_many_runs') ?? 0)) / $closed * 100) . ' % needed > 3 runs' : NULL,
      ],
    );

    $rated = (int) ($current('rated_tickets') ?? 0);
    $tiles['job_rating'] = self::sampled(
      $rated,
      'rated tickets',
      $current('job_rating'),
      $previousSampled('rated_tickets', 'job_rating'),
      [
        'unit' => 'of 5, job rating',
        'label' => 'Rating',
        'source' => 'bb_measurement.job_rating',
        'info' => 'Mean job rating (1–5) of the tickets closed in the period. Unrated tickets are left out, never counted as 0.',
        'detail' => $rated . ' of ' . $closed . ' rated',
      ],
    );

    $tokens = $current('run_tokens') ?? 0;
    $perTicket = $current('tokens_per_ticket');
    $tiles['run_tokens'] = self::tile([
      'value' => FigureFormat::abbreviate($tokens),
      'unit' => 'tokens',
      'label' => 'AI usage',
      'source' => 'bb_measurement.run_tokens',
      'info' => 'Run tokens by run start (UTC). Not a billable quantity.',
      'exact' => FigureFormat::exactTokens($tokens),
      'detail' => $perTicket === NULL ? NULL : '≈ ' . FigureFormat::abbreviate($perTicket) . ' per closed ticket',
      'detail_exact' => $perTicket === NULL ? NULL : FigureFormat::exactTokens($perTicket, 'Run tokens ÷ closed tickets', 'tokens per closed ticket'),
    ], $compared && $previous('run_tokens') !== NULL ? self::percent($tokens, $previous('run_tokens'), FigureFormat::abbreviate($previous('run_tokens')), FigureFormat::exactTokens($previous('run_tokens'))) : NULL);
    return $tiles;
  }

  /**
   * A ratio or mean tile, withheld below the minimum sample.
   *
   * @param int $sample
   *   The tickets the value rests on.
   * @param string $noun
   *   What the sample counts, e.g. `closed tickets`.
   * @param int|float|null $value
   *   The current value.
   * @param int|float|null $previous
   *   The comparison value, NULL for none.
   * @param array<string, mixed> $props
   *   The remaining tile props.
   *
   * @return array<string, mixed>
   *   The tile.
   */
  private static function sampled(int $sample, string $noun, int|float|null $value, int|float|null $previous, array $props): array {
    if ($sample < FigureFormat::MIN_SAMPLE || $value === NULL) {
      $detail = 'n = ' . $sample . ' ' . $noun . ' · needs ' . FigureFormat::MIN_SAMPLE;
      return self::tile(['value' => '—', 'tone' => 'muted', 'detail' => $detail] + $props, NULL);
    }
    $comparison = $previous === NULL ? NULL : ['value' => FigureFormat::decimal($previous), 'label' => 'vs'] + FigureFormat::absoluteChange((float) $value, (float) $previous);
    return self::tile(['value' => FigureFormat::decimal($value)] + $props, $comparison);
  }

  /**
   * Runs per ticket from the raw counts, as the tables divide them.
   *
   * The evaluator's runs_per_ticket is pre-rounded to two decimals, so
   * formatting it rounds twice (3.647 → 3.65 → "3.7").
   */
  private static function ratio(int|float|null $runs, int|float|null $tickets): ?float {
    return $runs === NULL || !$tickets ? NULL : (float) $runs / (float) $tickets;
  }

  /**
   * A comparison in percent.
   *
   * @return array<string, string>
   *   The comparison prop.
   */
  private static function percent(int|float|null $value, int|float|null $previous, string $shown, ?string $exact = NULL): array {
    return ['value' => $shown, 'label' => 'vs'] + ($exact === NULL ? [] : ['exact' => $exact]) + FigureFormat::percentChange($value, $previous);
  }

  /**
   * The detail line "236 created · backlog +22": inflow and backlog change.
   */
  private static function backlog(int $created, int $closed, string $inflow): string {
    $growth = $created - $closed;
    return $created . ' ' . $inflow . ' · backlog ' . ($growth > 0 ? '+' . $growth : ($growth < 0 ? (string) $growth : '±0'));
  }

  /**
   * A kpi stat-tile render array.
   *
   * @param array<string, mixed> $props
   *   The tile props; NULL entries are dropped.
   * @param array<string, string>|null $comparison
   *   The comparison, NULL for none.
   *
   * @return array<string, mixed>
   *   The render array.
   */
  private static function tile(array $props, ?array $comparison): array {
    $props = array_filter($props + ['size' => 'kpi'], static fn($value): bool => $value !== NULL);
    if ($comparison !== NULL) {
      $props['comparison'] = $comparison;
    }
    return ['#type' => 'component', '#component' => 'bb_theme:stat-tile', '#props' => $props];
  }

}
