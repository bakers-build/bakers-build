import {
  lineText,
  panelSectionKey,
  type Section,
  type SectionLine,
  styledOf,
} from '../../../../Component/section-list/index.js';
import type { TicketDetailDocument } from '../../../../types.js';
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

export interface TicketSidebar {
  readonly details: readonly TicketProperty[];
  readonly links: readonly TicketProperty[];
  readonly related: readonly TicketProperty[];
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
