import type { StatisticFigureGroup } from './client.js';

const displayValue = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : String(value);

/**
 * Formats a magnitude with the correct thousands/millions/billions suffix,
 * dividing as often as the size needs: 844,000,000 is "844.0M", never the
 * "844.0k" a single division by 1000 gives.
 */
export function formatAxisMagnitude(value: number): string {
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000_000) {
    return `${sign}${(magnitude / 1_000_000_000).toFixed(1)}B`;
  }
  if (magnitude >= 1_000_000) {
    return `${sign}${(magnitude / 1_000_000).toFixed(1)}M`;
  }
  if (magnitude >= 1_000) {
    return `${sign}${(magnitude / 1_000).toFixed(1)}k`;
  }
  return Number.isInteger(magnitude)
    ? `${sign}${magnitude}`
    : magnitude.toFixed(1);
}

export function groupedFigureLines(
  groups: readonly StatisticFigureGroup[],
): string[] {
  return groups.flatMap((group) => [
    group.label,
    ...group.figures.flatMap((figure) => [
      figure.label,
      ...(figure.empty.is_empty
        ? [figure.empty.message ?? 'No data for this selection.']
        : figure.categories.map(
            (category) =>
              `${category.label} · ${figure.measurements
                .map(
                  (measurement) =>
                    `${measurement.label}: ${displayValue(
                      measurement.values[category.key],
                    )}`,
                )
                .join(' · ')}`,
          )),
      '',
    ]),
  ]);
}
