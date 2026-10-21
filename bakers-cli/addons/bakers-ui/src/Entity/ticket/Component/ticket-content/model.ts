import {
  lineText,
  panelSectionKey,
  type Section,
  type SectionLine,
  styledOf,
} from '../../../../Component/section-list/index.js';
import type { TicketDetailDocument } from '../../../../types.js';
import { compareRunsNewestFirst } from '../../../run/Data/runs.js';
import { relativeCreated } from '../comment-item/index.js';
import { TICKET_SECTIONS } from '../sections/index.js';
import {
  type AssignmentLabels,
  commentItems,
  descriptionSummary,
  firstLineSummary,
  headerCreatedBy,
  sectionsForTab,
} from '../ticket-detail/index.js';

export interface TicketContentEntry {
  readonly key: string;
  readonly title: string;
  readonly metadata?: string;
  readonly expandable: boolean;
  readonly collapsed: readonly SectionLine[];
  readonly expanded: readonly SectionLine[];
}

export interface TicketProperty {
  readonly key: string;
  readonly value: string;
  readonly ticketId?: string;
  readonly href?: string;
}

export interface TicketMatrixColumn {
  readonly key: string;
  readonly label: string;
}

export interface TicketMatrixCell {
  readonly intensity: number | null;
  readonly display: string;
  readonly value?: number;
}

export interface TicketMatrixRow {
  readonly id: string;
  readonly label: string;
  readonly cells: readonly TicketMatrixCell[];
}

export interface TicketHeatGrid {
  readonly columns: readonly TicketMatrixColumn[];
  readonly rows: readonly TicketMatrixRow[];
}

export interface TicketMetricMatrix {
  readonly ticket: TicketHeatGrid;
  readonly runs: TicketHeatGrid;
}

export interface TicketSidebar {
  readonly details: readonly TicketProperty[];
  readonly links: readonly TicketProperty[];
  readonly related: readonly TicketProperty[];
  readonly matrix: TicketMetricMatrix;
  readonly showMetrics: boolean;
}

export interface TicketContentModel {
  readonly entries: readonly TicketContentEntry[];
  readonly selectableKeys: readonly string[];
  readonly sidebar?: TicketSidebar;
}

export type TicketContentTab = 'overview' | 'planning' | 'comments';

export const documentTabLabel = (title: string): string => {
  if (title === 'Latest summary') return 'Summary';
  if (title === 'Latest spec') return 'Spec';
  if (title === 'Latest plan') return 'Plan';
  if (title === 'Latest test') return 'Test';
  return title;
};

const ROW_PREFIX = 'ticket-content';
const OVERVIEW_TAB = TICKET_SECTIONS.findIndex((tab) => tab.id === 'overview');

const PLANNING_DOCUMENTS = [
  { heading: 'Latest spec', type: 'spec', empty: 'No spec comment.' },
  { heading: 'Latest plan', type: 'plan', empty: 'No plan comment.' },
  { heading: 'Latest test', type: 'test', empty: 'No test comment.' },
] as const;

const isBlankLine = (line: SectionLine): boolean =>
  lineText(line).trim() === '';

const isBlankBody = (lines: readonly SectionLine[]): boolean =>
  lines.length === 0 || lines.every(isBlankLine);

const sectionByHeading = (
  document: TicketDetailDocument,
  labels: AssignmentLabels | undefined,
  nowSeconds: number,
  baseUrl?: string,
): Map<string, Section> =>
  new Map(
    sectionsForTab(document, OVERVIEW_TAB, labels, nowSeconds, baseUrl).map(
      (section) => [section.heading, section],
    ),
  );

const contentEntry = (
  key: string,
  title: string,
  expandable: boolean,
  collapsed: readonly SectionLine[],
  expanded: readonly SectionLine[],
  metadata?: string,
): TicketContentEntry =>
  metadata === undefined
    ? { key, title, expandable, collapsed, expanded }
    : { key, title, metadata, expandable, collapsed, expanded };

const sectionKey = (heading: string): string => `section:${heading}`;

const described = (
  heading: string,
  lines: readonly SectionLine[],
  empty: string,
): TicketContentEntry => {
  const expanded = isBlankBody(lines) ? [empty] : lines;
  return contentEntry(
    sectionKey(heading),
    heading,
    true,
    descriptionSummary(expanded.map(styledOf)),
    expanded,
  );
};

const NONE = 'none';

const property = (
  key: string,
  value: string,
  extra: { ticketId?: string; href?: string } = {},
): TicketProperty => {
  const trimmed = value.trim();
  const empty =
    trimmed === '' || trimmed === '—' || /^(no\s|not\s)/i.test(trimmed);
  return {
    key,
    value: empty ? NONE : trimmed,
    ...(extra.ticketId === undefined ? {} : { ticketId: extra.ticketId }),
    ...(extra.href === undefined ? {} : { href: extra.href }),
  };
};

const asLines = (items: readonly TicketProperty[]): SectionLine[] =>
  items.map((item) => `${item.key}: ${item.value}`);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const relationshipIds = (
  document: TicketDetailDocument,
  name: string,
): string[] => {
  const data = document.data?.relationships?.[name]?.data;
  return (Array.isArray(data) ? data : data ? [data] : [])
    .map((item) => item?.id)
    .filter((id): id is string => typeof id === 'string' && id !== '');
};

const ticketLabel = (document: TicketDetailDocument, id: string): string => {
  const ticket = (document.included ?? []).find(
    (resource) =>
      resource.id === id && resource.type === 'bb_ticket--bb_ticket',
  );
  const identifier = asString(ticket?.attributes?.identifier);
  const title = asString(ticket?.attributes?.title);
  if (identifier === undefined && title === undefined) return id;
  return [identifier, title].filter((part) => part !== undefined).join(' · ');
};

const relatedTicketProperties = (
  document: TicketDetailDocument,
  name: string,
  key: string,
): TicketProperty[] => {
  const ids = relationshipIds(document, name);
  if (ids.length === 0) return [property(key, '')];
  return ids.map((id) =>
    property(key, ticketLabel(document, id), { ticketId: id }),
  );
};

const colonValue = (text: string): string => {
  const index = text.indexOf(':');
  return index < 0 ? text : text.slice(index + 1);
};

const PRIORITY_LABEL: Record<string, string> = {
  '1': 'high',
  '2': 'medium',
  '3': 'low',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const lifecycleProperties = (
  document: TicketDetailDocument,
): TicketProperty[] => {
  const attributes = document.data?.attributes ?? {};
  const priorityKey = String(attributes.priority ?? '').toLowerCase();
  const extras: TicketProperty[] = [
    property('priority', PRIORITY_LABEL[priorityKey] ?? ''),
    property('closed', attributes.closed === true ? 'yes' : 'no'),
  ];
  const frozenAtRaw = attributes.frozen_at;
  const frozenAt =
    asString(frozenAtRaw) ??
    (typeof frozenAtRaw === 'number' && frozenAtRaw > 0
      ? new Date(frozenAtRaw * 1000).toISOString()
      : undefined);
  if (attributes.frozen === true) {
    extras.push(property('frozen', 'yes'));
    if (frozenAt !== undefined) extras.push(property('frozen at', frozenAt));
  }
  const stall = asString(attributes.stall_reason);
  if (stall !== undefined) {
    // `property()` treats values that start with "no " as empty states
    // (`No conductor.` → none). `no conductor` is a real stall reason, so
    // the value is kept verbatim.
    extras.push({ key: 'stall', value: stall });
  }
  const createdAt = asString(attributes.created);
  if (createdAt !== undefined) extras.push(property('created at', createdAt));
  const changed = asString(attributes.changed);
  if (changed !== undefined) extras.push(property('changed', changed));
  return extras;
};

const technicalProperties = (
  byHeading: Map<string, Section>,
  document: TicketDetailDocument,
  labels?: AssignmentLabels,
): TicketProperty[] => {
  const assignment = byHeading.get('Assignment')?.lines ?? [];
  const assigned: TicketProperty[] = [];
  const reviewers: TicketProperty[] = [];
  const conductor: TicketProperty[] = [];
  for (const line of assignment) {
    const text = lineText(line).trim();
    if (text === 'Unassigned.') assigned.push(property('assigned', ''));
    else if (text.startsWith('Assignee:'))
      assigned.push(property('assigned', colonValue(text)));
    else if (text.startsWith('Reviewers:')) {
      const value = colonValue(text);
      reviewers.push(property('reviewers', value === '—' ? '' : value));
    } else if (text === 'No conductor.')
      conductor.push(property('conductor', ''));
    else if (text.startsWith('Conductor:'))
      conductor.push(property('conductor', colonValue(text)));
  }
  const parentId = relationshipIds(document, 'parent_id')[0];
  const parentText = lineText((byHeading.get('Parent')?.lines ?? [])[0] ?? '');
  const branch: TicketProperty[] = [];
  for (const line of byHeading.get('Branch')?.lines ?? []) {
    const text = lineText(line).trim();
    const index = text.indexOf(':');
    if (index < 0) continue;
    branch.push(
      property(
        text.slice(0, index).trim().toLowerCase(),
        text.slice(index + 1),
      ),
    );
  }
  const time: TicketProperty[] = [];
  const timeLines = byHeading.get('Time')?.lines ?? [];
  if (
    timeLines.length === 1 &&
    lineText(timeLines[0] ?? '').trim() === 'No estimate and no accounted time.'
  ) {
    time.push(property('estimate', ''), property('spent', ''));
  } else {
    for (const line of timeLines) {
      const text = lineText(line).trim();
      const index = text.indexOf(':');
      if (index < 0) continue;
      time.push(
        property(
          text.slice(0, index).trim().toLowerCase(),
          text.slice(index + 1),
        ),
      );
    }
  }
  const environmentLines = byHeading.get('Environments')?.lines ?? [];
  const environmentText = lineText(environmentLines[0] ?? '').trim();
  const environmentCount = /^(\d+)\s+environments$/i.exec(environmentText);
  const environments =
    environmentText === '' || environmentText === 'No environments.'
      ? [property('environments', '')]
      : environmentCount?.[1] !== undefined
        ? [property('environments', environmentCount[1])]
        : [property('environments', environmentText)];
  return [
    property(
      'parent',
      parentText,
      parentId === undefined ? {} : { ticketId: parentId },
    ),
    ...(assigned.length > 0 ? assigned : [property('assigned', '')]),
    ...(reviewers.length > 0 ? reviewers : [property('reviewers', '')]),
    property('created', headerCreatedBy(document, labels)),
    ...lifecycleProperties(document),
    ...branch,
    ...(conductor.length > 0 ? conductor : [property('conductor', '')]),
    ...time,
    ...environments,
  ];
};

const linkProperties = (lines: readonly SectionLine[]): TicketProperty[] => {
  const meaningful = lines.filter((line) => {
    const text = lineText(line).trim();
    return text !== '' && text !== 'No links.';
  });
  if (meaningful.length === 0) return [property('links', '')];
  return meaningful.map((line) => {
    const text = lineText(line).trim();
    const match = /^(.*?)\s+(https?:\/\/\S+)$/.exec(text);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return property(match[1], match[2], { href: match[2] });
    }
    if (text.startsWith('http://') || text.startsWith('https://')) {
      return property('link', text, { href: text });
    }
    return property('link', text);
  });
};

const relatedProperties = (
  document: TicketDetailDocument,
): TicketProperty[] => [
  originProperty(document, 'source') ?? property('source', ''),
  ...relatedTicketProperties(document, 'parent_id', 'parent'),
  ...relatedTicketProperties(document, 'sub_tickets', 'sub-ticket'),
  ...relatedTicketProperties(document, 'blocked_by', 'blocked by'),
  ...relatedTicketProperties(document, 'referenced_tickets', 'referenced'),
];

const parseMetricNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = asString(value);
  if (raw === undefined) return undefined;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const METRIC_LABEL: Record<string, string> = {
  ac_pass_rate: 'AC',
  review_bounces: 'bounce',
  time_to_done_h: 'time',
  rework_followups: 'rework',
  human_interventions: 'human',
  'job_rating.score': 'score',
};

const metricLabel = (name: string): string =>
  METRIC_LABEL[name] ?? name.replaceAll('_', ' ').replaceAll('.', ' ');

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const intensityAgainst = (value: number, cap: number): number =>
  cap <= 0 ? 0 : clamp01(value / cap);

const attrNumber = (
  attributes: Record<string, unknown> | undefined,
  name: string,
): number => {
  const numeric = parseMetricNumber(attributes?.[name]);
  return numeric === undefined ? 0 : numeric;
};

const runResources = (document: TicketDetailDocument) =>
  (document.included ?? [])
    .filter((resource) => resource.type === 'bb_run--bb_run')
    .slice()
    .sort(compareRunsNewestFirst);

export const FOOTPRINT_COLUMNS: readonly TicketMatrixColumn[] = [
  { key: 'tokens', label: 'tok' },
  { key: 'duration_s', label: 'dur' },
  { key: 'agent_turns', label: 'trn' },
  { key: 'tool_calls', label: 'tl' },
];

const MAX_MATRIX_RUNS = 12;

const formatCompact = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')}m`;
  }
  if (abs >= 1000) {
    const scaled = value / 1000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(Math.round(value));
};

const formatDurationCell = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1).replace(/\.0$/, '')}h`;
};

const footprintDisplay = (key: string, value: number): string => {
  if (key === 'tokens') return formatCompact(value);
  if (key === 'duration_s') return formatDurationCell(value);
  return String(Math.round(value));
};

const ticketMetricCell = (
  name: string,
  value: unknown,
  unit: string | undefined,
): { intensity: number; display: string } | undefined => {
  const numeric = parseMetricNumber(value);
  if (numeric === undefined) return undefined;
  if (name === 'job_rating.score') {
    return {
      intensity: intensityAgainst(numeric, 5),
      display: String(Math.round(numeric)),
    };
  }
  const isRatio =
    unit === 'ratio' || (unit === undefined && name.endsWith('_rate'));
  if (isRatio) {
    const ratio = numeric > 1 ? numeric / 100 : numeric;
    return {
      intensity: clamp01(ratio),
      display: `${Math.round(ratio * 100)}%`,
    };
  }
  if (unit === 'h' || name.endsWith('_h')) {
    return {
      intensity: intensityAgainst(numeric, 48),
      display: `${formatCompact(numeric)}h`,
    };
  }
  return {
    intensity: intensityAgainst(numeric, 5),
    display: formatCompact(numeric),
  };
};

const ticketMetricColumns = (
  document: TicketDetailDocument,
): {
  columns: TicketMatrixColumn[];
  cells: { intensity: number; display: string }[];
} => {
  const raw = document.data?.attributes?.metrics;
  const rows = Array.isArray(raw) ? raw : [];
  const columns: TicketMatrixColumn[] = [];
  const cells: { intensity: number; display: string }[] = [];
  let score:
    | {
        column: TicketMatrixColumn;
        cell: { intensity: number; display: string };
      }
    | undefined;
  const extras: {
    column: TicketMatrixColumn;
    cell: { intensity: number; display: string };
  }[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const metric = row as Record<string, unknown>;
    const name = asString(metric.name);
    if (name === undefined) continue;
    const cell = ticketMetricCell(name, metric.value, asString(metric.unit));
    if (cell === undefined) continue;
    const column = { key: name, label: metricLabel(name) };
    if (name === 'job_rating.score') score = { column, cell };
    else extras.push({ column, cell });
  }
  if (score !== undefined) {
    columns.push(score.column);
    cells.push(score.cell);
  }
  for (const extra of extras) {
    columns.push(extra.column);
    cells.push(extra.cell);
  }
  return { columns, cells };
};

const runLabel = (
  attributes: Record<string, unknown> | undefined,
  id: string,
): string => {
  const internal = attributes?.drupal_internal__id;
  if (typeof internal === 'number' || typeof internal === 'string') {
    return `#${internal}`;
  }
  return id.slice(0, 6);
};

const EMPTY_GRID: TicketHeatGrid = { columns: [], rows: [] };

const normalizeRunRows = (
  rows: readonly {
    id: string;
    label: string;
    values: readonly number[];
    displays: readonly string[];
  }[],
): TicketMatrixRow[] => {
  const width = rows[0]?.values.length ?? 0;
  const peaks = Array.from({ length: width }, (_unused, column) => {
    let peak = 0;
    for (const row of rows) {
      const value = row.values[column];
      if (typeof value === 'number' && value > peak) peak = value;
    }
    return peak;
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    cells: row.values.map((value, column) => {
      const peak = peaks[column] ?? 0;
      return {
        intensity: peak > 0 ? clamp01(value / peak) : 0,
        display: row.displays[column] ?? String(value),
        value,
      };
    }),
  }));
};

const metricMatrix = (document: TicketDetailDocument): TicketMetricMatrix => {
  const runs = runResources(document).slice(0, MAX_MATRIX_RUNS);
  const ticket = ticketMetricColumns(document);
  const footprint = FOOTPRINT_COLUMNS.filter((column) =>
    runs.some((run) => attrNumber(run.attributes, column.key) > 0),
  );

  const ticketGrid: TicketHeatGrid =
    ticket.columns.length === 0
      ? EMPTY_GRID
      : {
          columns: ticket.columns,
          rows: [
            {
              id: 'ticket',
              label: '',
              cells: ticket.cells.map((cell) => ({
                intensity: cell.intensity,
                display: cell.display,
              })),
            },
          ],
        };

  const runsGrid: TicketHeatGrid =
    footprint.length === 0 || runs.length === 0
      ? EMPTY_GRID
      : {
          columns: footprint,
          rows: normalizeRunRows(
            runs.map((run) => ({
              id: run.id ?? '',
              label: runLabel(run.attributes, run.id ?? ''),
              values: footprint.map((column) =>
                attrNumber(run.attributes, column.key),
              ),
              displays: footprint.map((column) =>
                footprintDisplay(
                  column.key,
                  attrNumber(run.attributes, column.key),
                ),
              ),
            })),
          ),
        };

  return { ticket: ticketGrid, runs: runsGrid };
};

const originProperty = (
  document: TicketDetailDocument,
  key = 'origin',
): TicketProperty | undefined => {
  const origin = asString(document.data?.attributes?.origin);
  if (origin === undefined) return undefined;
  return property(
    key,
    origin,
    origin.startsWith('http') ? { href: origin } : {},
  );
};

const EMPTY_SUMMARY = 'No summary comment.';

const hasSummary = (lines: readonly SectionLine[]): boolean => {
  const text = lines
    .map((line) => lineText(line).trim())
    .filter((line) => line !== '');
  return text.length > 0 && text.some((line) => line !== EMPTY_SUMMARY);
};

const overviewModel = (
  document: TicketDetailDocument,
  labels: AssignmentLabels | undefined,
  nowSeconds: number,
  baseUrl?: string,
): { entries: TicketContentEntry[]; sidebar: TicketSidebar } => {
  const byHeading = sectionByHeading(document, labels, nowSeconds, baseUrl);
  const summaryLines = byHeading.get('Latest summary')?.lines ?? [];
  const documents: TicketContentEntry[] = [];
  if (hasSummary(summaryLines)) {
    documents.push(
      contentEntry(
        sectionKey('Latest summary'),
        'Latest summary',
        true,
        firstLineSummary(summaryLines.map(styledOf)),
        summaryLines,
      ),
    );
  }
  // Shown only to the current assignee, whose detail read carries the queue.
  const pendingLines = byHeading.get('Pending reviews')?.lines ?? [];
  if (pendingLines.length > 0) {
    documents.push(
      contentEntry(
        sectionKey('Pending reviews'),
        'Pending reviews',
        true,
        pendingLines.slice(0, 1),
        pendingLines,
      ),
    );
  }
  documents.push(
    described(
      'Description',
      byHeading.get('Description')?.lines ?? ['No description.'],
      'No description.',
    ),
  );
  const details = technicalProperties(byHeading, document, labels);
  const technical = asLines(details);
  const listedLinks = linkProperties(byHeading.get('Links')?.lines ?? []);
  const origin = originProperty(document);
  const links =
    origin === undefined
      ? listedLinks
      : [origin, ...listedLinks.filter((item) => item.value !== 'none')];
  const matrix = metricMatrix(document);
  // Stats are a retrospective: they only make sense — and only appear — once the
  // ticket has reached `done`, never mid-flight.
  const isDone = document.data?.attributes?.state === 'done';
  return {
    entries: [
      ...documents,
      contentEntry(
        sectionKey('Technical details'),
        'Technical details',
        false,
        technical,
        technical,
      ),
    ],
    sidebar: {
      details,
      links,
      related: relatedProperties(document),
      matrix,
      showMetrics: isDone,
    },
  };
};

const planningModel = (
  document: TicketDetailDocument,
  nowSeconds: number,
): TicketContentEntry[] => {
  const items = commentItems(document);
  return PLANNING_DOCUMENTS.map(({ heading, type, empty }) => {
    const item = items.find((comment) => comment.type === type);
    if (item === undefined) {
      return described(heading, [empty], empty);
    }
    const body = isBlankBody(item.bodyLines) ? [] : item.bodyLines;
    const expanded: SectionLine[] = body;
    return contentEntry(
      sectionKey(heading),
      heading,
      true,
      descriptionSummary(expanded.map(styledOf)),
      expanded,
      `${item.author || '—'} · ${relativeCreated(item.created, nowSeconds)}`,
    );
  });
};

const commentsModel = (
  document: TicketDetailDocument,
  nowSeconds: number,
): TicketContentEntry[] =>
  commentItems(document).map((item) => {
    const blank = isBlankBody(item.bodyLines);
    const expanded: readonly SectionLine[] = blank
      ? ['No comment content.']
      : item.bodyLines;
    return contentEntry(
      `comment:${item.id}`,
      item.type,
      true,
      blank ? ['No comment content.'] : [],
      expanded,
      `${item.author || '—'} · ${relativeCreated(item.created, nowSeconds)}`,
    );
  });

export function ticketContentModel(
  document: TicketDetailDocument,
  tab: TicketContentTab,
  labels: AssignmentLabels | undefined,
  nowSeconds: number,
  baseUrl?: string,
): TicketContentModel {
  if (tab === 'overview') {
    const { entries, sidebar } = overviewModel(
      document,
      labels,
      nowSeconds,
      baseUrl,
    );
    return {
      entries,
      selectableKeys: entries.map((entry) => entry.key),
      sidebar,
    };
  }
  const entries =
    tab === 'planning'
      ? planningModel(document, nowSeconds)
      : commentsModel(document, nowSeconds);
  return {
    entries,
    selectableKeys: entries.map((entry) => entry.key),
  };
}

export function ticketContentRowId(key: string): string {
  return `${ROW_PREFIX}-${panelSectionKey(key)}`;
}

export function resolveSelectedKey(
  selectableKeys: readonly string[],
  previous: string | undefined,
): string | undefined {
  if (previous !== undefined && selectableKeys.includes(previous))
    return previous;
  return selectableKeys[0];
}

export function retainExpandedKeys(
  keys: readonly string[],
  previous: ReadonlySet<string>,
): Set<string> {
  const live = new Set(keys);
  return new Set([...previous].filter((key) => live.has(key)));
}

// The two Overview entries an operator reads on open: where the work stands,
// and what the work is. Matched by KEY rather than by index, so an absent entry
// — a ticket with no summary comment — simply contributes nothing, and a future
// entry inserted above cannot shift the default onto the wrong row.
const OVERVIEW_INITIAL_EXPANDED: ReadonlySet<string> = new Set([
  'section:Latest summary',
  'section:Description',
]);

export function initialExpandedKeys(
  tab: TicketContentTab,
  model: TicketContentModel,
): Set<string> {
  if (tab === 'overview') {
    return new Set(
      model.selectableKeys.filter((key) => OVERVIEW_INITIAL_EXPANDED.has(key)),
    );
  }
  if (tab === 'comments' && model.selectableKeys[0] !== undefined) {
    return new Set([model.selectableKeys[0]]);
  }
  if (tab === 'planning') {
    return new Set(model.selectableKeys);
  }
  return new Set();
}
