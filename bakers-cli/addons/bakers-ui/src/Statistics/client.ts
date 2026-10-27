import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import type { DropshClient } from '../types.js';

export type StatisticsContextKey = 'workspace' | 'project' | 'team' | 'user';
export type StatisticsContexts = Partial<Record<StatisticsContextKey, string>>;
export type StatisticsFilters = Record<string, string>;

export interface StatisticCategory {
  key: string;
  label: string;
  partial?: boolean;
}

export interface StatisticMeasurement {
  id: string;
  label: string;
  value_type: 'integer' | 'decimal';
  unit: string;
  values: Record<string, number | null>;
}

export interface StatisticFilterOption {
  value: string;
  label: string;
}

export interface StatisticFilter {
  label: string;
  value: string;
  options: StatisticFilterOption[];
}

const GROUPINGS = ['day', 'week', 'month', 'quarter'] as const;

const WIDGETS = [
  'matrix',
  'line',
  'grouped_horizontal_bars',
  'bars',
  'tiles',
  'flow',
  'table',
] as const;

export interface StatisticFigure {
  id: string;
  label: string;
  description: string;
  /** `tiles`, `flow`, `table` and `bars` render through the bars fallback. */
  widget: (typeof WIDGETS)[number];
  generated: string;
  filters: Record<string, StatisticFilter>;
  /** Bucket size of the selected period; absent on `windows` figures. */
  period?: { grouping: (typeof GROUPINGS)[number] };
  categories: StatisticCategory[];
  measurements: StatisticMeasurement[];
  empty: { is_empty: boolean; message: string | null };
  cache: { max_age: number; contexts: string[]; tags: string[] };
}

export interface StatisticFigureGroup {
  id: string;
  label: string;
  figures: StatisticFigure[];
}

export type GroupStatisticsResult =
  | { kind: 'ok'; groups: StatisticFigureGroup[] }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

function statusOf(caught: unknown): number | undefined {
  if (typeof caught !== 'object' || caught === null) return undefined;
  const status = (caught as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function jsonApiErrorDetail(caught: unknown): string | undefined {
  if (typeof caught !== 'object' || caught === null) return undefined;
  const raw = (caught as { body?: unknown }).body;
  let body: unknown = raw;
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof body !== 'object' || body === null) return undefined;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const first = (errors[0] ?? {}) as Record<string, unknown>;
  const detail = first.detail ?? first.title;
  return typeof detail === 'string' && detail !== '' ? detail : 'HTTP 404';
}

export function errorResultOf(
  caught: unknown,
): { kind: 'unsupported' } | { kind: 'error'; message: string } {
  if (statusOf(caught) === 404) {
    const detail = jsonApiErrorDetail(caught);
    if (detail === undefined) return { kind: 'unsupported' };
    return { kind: 'error', message: detail };
  }
  return {
    kind: 'error',
    message: caught instanceof Error ? caught.message : String(caught),
  };
}

const recordOf = (value: unknown): Record<string, unknown> | undefined => {
  // PHP cannot preserve the distinction between an empty associative map and
  // an empty list. Drupal therefore serializes empty `filters` and `values`
  // maps as `[]`; accept only that empty-array case and normalize it to a map.
  if (Array.isArray(value)) return value.length === 0 ? {} : undefined;
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
};

function categoryOf(value: unknown): StatisticCategory | undefined {
  const row = recordOf(value);
  if (!row || typeof row.key !== 'string' || typeof row.label !== 'string')
    return undefined;
  return {
    key: row.key,
    label: row.label,
    ...(row.partial === true ? { partial: true } : {}),
  };
}

function measurementOf(value: unknown): StatisticMeasurement | undefined {
  const row = recordOf(value);
  const values = recordOf(row?.values);
  if (
    !row ||
    !values ||
    typeof row.id !== 'string' ||
    typeof row.label !== 'string' ||
    (row.value_type !== 'integer' && row.value_type !== 'decimal') ||
    typeof row.unit !== 'string'
  )
    return undefined;
  const parsed: Record<string, number | null> = {};
  for (const [key, item] of Object.entries(values)) {
    if (item !== null && (typeof item !== 'number' || !Number.isFinite(item)))
      return undefined;
    parsed[key] = item;
  }
  return {
    id: row.id,
    label: row.label,
    value_type: row.value_type,
    unit: row.unit,
    values: parsed,
  };
}

function filterOf(value: unknown): StatisticFilter | undefined {
  const row = recordOf(value);
  if (
    !row ||
    typeof row.label !== 'string' ||
    typeof row.value !== 'string' ||
    !Array.isArray(row.options)
  )
    return undefined;
  const options: StatisticFilterOption[] = [];
  for (const option of row.options) {
    const item = recordOf(option);
    if (
      !item ||
      typeof item.value !== 'string' ||
      typeof item.label !== 'string'
    )
      return undefined;
    options.push({ value: item.value, label: item.label });
  }
  return { label: row.label, value: row.value, options };
}

function figureOf(value: unknown): StatisticFigure | undefined {
  const row = recordOf(value);
  const empty = recordOf(row?.empty);
  const cache = recordOf(row?.cache);
  const filters = recordOf(row?.filters);
  if (
    !row ||
    !empty ||
    !cache ||
    !filters ||
    typeof row.id !== 'string' ||
    typeof row.label !== 'string' ||
    typeof row.description !== 'string' ||
    !(WIDGETS as readonly string[]).includes(String(row.widget)) ||
    typeof row.generated !== 'string' ||
    !Array.isArray(row.categories) ||
    !Array.isArray(row.measurements) ||
    typeof empty.is_empty !== 'boolean' ||
    (empty.message !== null && typeof empty.message !== 'string') ||
    typeof cache.max_age !== 'number' ||
    !Array.isArray(cache.contexts) ||
    !cache.contexts.every((item) => typeof item === 'string') ||
    !Array.isArray(cache.tags) ||
    !cache.tags.every((item) => typeof item === 'string')
  )
    return undefined;

  const categories = row.categories.map(categoryOf);
  const measurements = row.measurements.map(measurementOf);
  if (categories.includes(undefined) || measurements.includes(undefined))
    return undefined;

  const grouping = recordOf(row.period)?.grouping;
  const period = GROUPINGS.find((item) => item === grouping);

  const parsedFilters: Record<string, StatisticFilter> = {};
  for (const [key, item] of Object.entries(filters)) {
    // An entity filter (project, team, person) picks UUIDs in the web UI; the
    // cockpit offers no picker for it, so it is left out, not refused.
    if (recordOf(item)?.type === 'entities') continue;
    const parsed = filterOf(item);
    if (!parsed) return undefined;
    parsedFilters[key] = parsed;
  }

  return {
    id: row.id,
    label: row.label,
    description: row.description,
    widget: row.widget as StatisticFigure['widget'],
    generated: row.generated,
    filters: parsedFilters,
    ...(period ? { period: { grouping: period } } : {}),
    categories: categories as StatisticCategory[],
    measurements: measurements as StatisticMeasurement[],
    empty: {
      is_empty: empty.is_empty,
      message: empty.message as string | null,
    },
    cache: {
      max_age: cache.max_age,
      contexts: cache.contexts as string[],
      tags: cache.tags as string[],
    },
  };
}

function groupOf(value: unknown): StatisticFigureGroup | undefined {
  const row = recordOf(value);
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.label !== 'string' ||
    !Array.isArray(row.figures)
  )
    return undefined;
  // A figure whose widget the CLI cannot draw is skipped, not malformed.
  const figures = row.figures
    .filter((figure) =>
      (WIDGETS as readonly string[]).includes(String(recordOf(figure)?.widget)),
    )
    .map(figureOf);
  if (figures.includes(undefined)) return undefined;
  return {
    id: row.id,
    label: row.label,
    figures: figures as StatisticFigure[],
  };
}

interface StatisticsDocument {
  data?: { attributes?: { groups?: unknown } } | null;
}

export async function loadGroupStatistics(
  client: DropshClient,
  contexts: StatisticsContexts,
  filters: StatisticsFilters = {},
): Promise<GroupStatisticsResult> {
  const params = new DrupalJsonApiParams();
  for (const [key, id] of Object.entries(contexts)) {
    if (id) params.addCustomParam({ [`${key}_id`]: id });
  }
  if (Object.keys(filters).length > 0)
    params.addCustomParam({ filter: filters });

  let document: StatisticsDocument;
  try {
    document = (await client.get(
      'bakers/statistics',
      params,
    )) as StatisticsDocument;
  } catch (caught) {
    return errorResultOf(caught);
  }

  const source = document.data?.attributes?.groups;
  if (!Array.isArray(source))
    return { kind: 'error', message: 'malformed statistics document' };
  const groups = source.map(groupOf);
  if (groups.includes(undefined))
    return { kind: 'error', message: 'malformed statistics document' };
  return {
    kind: 'ok',
    groups: (groups as StatisticFigureGroup[]).filter(
      (group) => group.figures.length > 0,
    ),
  };
}
