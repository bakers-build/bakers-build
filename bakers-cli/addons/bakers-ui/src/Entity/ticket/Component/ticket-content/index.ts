import { BoxRenderable, h, type RGBA, type VNode } from '@opentui/core';
import { Card } from '../../../../Component/card/index.js';
import { Divider } from '../../../../Component/divider/index.js';
import { HeatMap } from '../../../../Component/heat-map/index.js';
import {
  KeyValue,
  type KeyValueItem,
} from '../../../../Component/key-value/index.js';
import {
  HeadlineMarkdown,
  MarkdownLines,
} from '../../../../Component/markdown/index.js';
import {
  lineText,
  type SectionCells,
  type SectionLine,
} from '../../../../Component/section-list/index.js';
import {
  BORDER,
  FOREGROUND,
  FOREGROUND_ACTIVE,
  FOREGROUND_HIGHLIGHT,
} from '../../../../lib/theme.js';
import {
  BOLD,
  DIM,
  paragraphNode,
  plainRun,
  pressHandler,
  type StyledLine,
} from '../../../../lib/vnode.js';
import type { TicketAddons } from '../../Data/addons.js';
import {
  documentTabLabel,
  type TicketContentEntry,
  type TicketContentModel,
  type TicketContentTab,
  type TicketHeatGrid,
  type TicketMetricMatrix,
  type TicketProperty,
  type TicketSidebar,
  ticketContentRowId,
} from './model.js';

// Links are NOT here: a URL cannot fit the narrow sidebar without wrapping, so
// they render full-width in the left column (see linksSection) instead.
export const SIDEBAR_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'stats', label: 'Stats' },
  { id: 'related', label: 'Related' },
] as const;
export type SidebarTabId = (typeof SIDEBAR_TABS)[number]['id'];

/** The pane a sidebar opens on: Stats once the ticket is done, else Details. */
export const defaultSidebarTab = (sidebar: TicketSidebar): SidebarTabId =>
  sidebar.showMetrics ? 'stats' : 'details';

export interface TicketContentProps {
  /** The owner every node id derives from. */
  readonly id: string;
  readonly model: TicketContentModel;
  readonly tab: TicketContentTab;
  readonly selectedKey?: string;
  readonly expandedKeys: ReadonlySet<string>;
  readonly select: (key: string) => void;
  readonly toggle: (key: string) => void;
  readonly activateProperty?: (item: TicketProperty) => void;
  /** Terminal width — the Overview's side-by-side breakpoint reads it. */
  readonly terminalColumns: number;
  /** The visit's sidebar pane; absent means {@link defaultSidebarTab}. */
  readonly sidebarTab?: SidebarTabId;
  readonly onSidebarTab: (tab: SidebarTabId) => void;
  /** The Planning document tab last chosen in this visit. */
  readonly documentKey?: string;
  readonly onDocumentTab: (key: string) => void;
  /**
   * The ticket's conductor-run addons (BB-661), rendered as a second,
   * unlabeled card below the sidebar — never visible as "addon" wording.
   * Absent (or empty) omits the card entirely.
   */
  readonly addonsPreview?: TicketAddons;
  readonly onOpenAddons?: () => void;
}

const isCells = (line: SectionLine): line is SectionCells =>
  typeof line !== 'string' && 'cells' in line;

const isStyled = (line: SectionLine): line is StyledLine =>
  typeof line !== 'string' && 'runs' in line;

const TECHNICAL_KEY = 'section:Technical details';
const LINKS_KEY = 'section:Links';
const WIDE_OVERVIEW_COLUMNS = 100;

const column = (
  id: string,
  props: Record<string, unknown>,
  ...children: VNode[]
): VNode =>
  h(BoxRenderable, { id, flexDirection: 'column', ...props }, ...children);

const kvItems = (lines: readonly SectionLine[]): KeyValueItem[] => {
  const items: KeyValueItem[] = [];
  for (const line of lines) {
    const text = lineText(line).trim();
    if (text === '') continue;
    const index = text.indexOf(':');
    if (index < 0) {
      items.push({ key: '', value: text });
      continue;
    }
    items.push({
      key: text.slice(0, index).trim(),
      value: text.slice(index + 1).trim(),
    });
  }
  return items;
};

const linkItems = (lines: readonly SectionLine[]): KeyValueItem[] => {
  const items: KeyValueItem[] = [];
  for (const line of lines) {
    const text = lineText(line).trim();
    if (text === '') continue;
    const match = /^(.*?)\s+(https?:\/\/\S+)$/.exec(text);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      items.push({ key: match[1], value: match[2] });
      continue;
    }
    items.push({ key: '', value: text });
  }
  return items;
};

/** Plain and cell rows as wrapped paragraphs, styled runs as Markdown. */
const lines = (
  id: string,
  source: readonly SectionLine[],
  emphasis: boolean,
): VNode => {
  const parts: VNode[] = [];
  let styled: StyledLine[] = [];
  const flushStyled = () => {
    if (styled.length === 0) return;
    parts.push(
      MarkdownLines({ id: `${id}-${parts.length}`, lines: styled, emphasis }),
    );
    styled = [];
  };
  for (const line of source) {
    if (typeof line === 'string' || isCells(line)) {
      flushStyled();
      const text = typeof line === 'string' ? line : lineText(line);
      parts.push(
        paragraphNode({
          id: `${id}-${parts.length}`,
          runs: [plainRun(text, emphasis ? BOLD : 0)],
          fg: emphasis ? FOREGROUND_HIGHLIGHT : FOREGROUND,
          width: '100%',
          flexShrink: 0,
        }),
      );
      continue;
    }
    if (isStyled(line)) styled.push(line);
  }
  flushStyled();
  return column(id, { width: '100%' }, ...parts);
};

/**
 * A press on a region that does nothing. A selectable entry's row id sits on
 * an ENCLOSING node the kernel binds clicks to, so an area that must stay
 * inert has to consume its own press rather than let it bubble there.
 */
const INERT = (): void => {};

const activate = (
  entry: TicketContentEntry,
  select: (key: string) => void,
  toggle: (key: string) => void,
) => {
  select(entry.key);
  if (entry.expandable) toggle(entry.key);
};

const visibleLines = (
  entry: TicketContentEntry,
  expandedKeys: ReadonlySet<string>,
): readonly SectionLine[] =>
  expandedKeys.has(entry.key) ? entry.expanded : entry.collapsed;

const sectionBody = (
  id: string,
  entry: TicketContentEntry,
  expandedKeys: ReadonlySet<string>,
): VNode => {
  if (entry.key === TECHNICAL_KEY)
    return KeyValue({
      id,
      items: kvItems(entry.expanded),
      keyColor: FOREGROUND,
      valueColor: FOREGROUND_HIGHLIGHT,
    });
  if (entry.key === LINKS_KEY)
    return KeyValue({
      id,
      items: linkItems(visibleLines(entry, expandedKeys)),
      keyColor: FOREGROUND,
      valueColor: FOREGROUND_HIGHLIGHT,
    });
  return lines(
    id,
    visibleLines(entry, expandedKeys),
    entry.key.startsWith('section:'),
  );
};

/** A body that activates its entry while collapsed, and nothing once open. */
const entryBody = (
  id: string,
  entry: TicketContentEntry,
  props: TicketContentProps,
  layout: Record<string, unknown>,
): VNode => {
  const bodyActivates = entry.expandable && !props.expandedKeys.has(entry.key);
  return h(
    BoxRenderable,
    {
      id,
      flexDirection: 'column',
      width: '100%',
      ...layout,
      onMouseDown: pressHandler(
        bodyActivates
          ? () => activate(entry, props.select, props.toggle)
          : undefined,
      ),
    },
    sectionBody(`${id}-content`, entry, props.expandedKeys),
  );
};

const tabLabel = (
  id: string,
  label: string,
  active: boolean,
  fg: RGBA,
  onPress: () => void,
): VNode =>
  paragraphNode({
    id,
    runs: [plainRun(active ? `[${label}]` : ` ${label} `, active ? BOLD : 0)],
    fg,
    onMouseDown: onPress,
  });

const headlineContent = (
  id: string,
  tabs: readonly { id: string; label: string }[],
  activeId: string,
  selected: boolean,
  onTab: (id: string) => void,
  body: VNode,
): VNode => {
  const many = tabs.length > 1;
  return column(
    id,
    { width: '100%', flexGrow: 1, flexShrink: 1, marginTop: 1 },
    h(
      BoxRenderable,
      {
        id: ticketContentRowId(activeId),
        flexDirection: 'row',
        width: '100%',
        flexShrink: 0,
      },
      h(
        BoxRenderable,
        {
          id: `${id}-tabs`,
          flexDirection: 'row',
          width: '100%',
          flexShrink: 0,
          gap: 1,
          onMouseDown: pressHandler(INERT),
        },
        ...(many
          ? tabs.map((tab) =>
              tabLabel(
                `${id}-tab-${tab.id}`,
                tab.label,
                tab.id === activeId,
                tab.id === activeId
                  ? selected
                    ? FOREGROUND_ACTIVE
                    : FOREGROUND_HIGHLIGHT
                  : FOREGROUND,
                () => onTab(tab.id),
              ),
            )
          : [
              paragraphNode({
                id: `${id}-tab-only`,
                runs: [plainRun(tabs[0]?.label ?? '', BOLD)],
                fg: selected ? FOREGROUND_ACTIVE : FOREGROUND_HIGHLIGHT,
                onMouseDown: () => onTab(tabs[0]?.id ?? activeId),
              }),
            ]),
      ),
    ),
    Divider({
      id: `${id}-divider`,
      color: selected ? FOREGROUND_HIGHLIGHT : BORDER,
    }),
    column(
      `${id}-pane`,
      {
        width: '100%',
        flexGrow: 1,
        flexShrink: 1,
        paddingLeft: 1,
        marginTop: 1,
      },
      body,
    ),
  );
};

const overviewDocuments = (
  id: string,
  documents: readonly TicketContentEntry[],
  props: TicketContentProps,
): VNode =>
  column(
    id,
    { width: '100%', flexGrow: 1, flexShrink: 1, marginTop: 1 },
    ...documents.map((entry) =>
      HeadlineMarkdown({
        id: `${id}-${entry.key}`,
        headline: documentTabLabel(entry.title),
        headlineId: ticketContentRowId(entry.key),
        onMouseDown: () => activate(entry, props.select, props.toggle),
        paddingBottom: 1,
        paddingLeft: 1,
        children: [
          entryBody(`${id}-${entry.key}-entry`, entry, props, {
            flexShrink: 0,
          }),
        ],
      }),
    ),
  );

/** The Planning pane's active document: the selection, the visit's tab, or Description. */
export const activeDocumentKey = (
  documents: readonly TicketContentEntry[],
  selectedKey: string | undefined,
  documentKey: string | undefined,
): string | undefined => {
  const isDocument = (key: string | undefined) =>
    key !== undefined && documents.some((entry) => entry.key === key);
  if (isDocument(selectedKey)) return selectedKey;
  if (isDocument(documentKey)) return documentKey;
  return (
    documents.find((entry) => entry.key === 'section:Description')?.key ??
    documents[0]?.key
  );
};

const documentPane = (
  id: string,
  documents: readonly TicketContentEntry[],
  props: TicketContentProps,
): VNode => {
  const activeKey = activeDocumentKey(
    documents,
    props.selectedKey,
    props.documentKey,
  );
  const active =
    documents.find((entry) => entry.key === activeKey) ?? documents[0];
  if (active === undefined) return column(id, {});
  return headlineContent(
    id,
    documents.map((entry) => ({
      id: entry.key,
      label: documentTabLabel(entry.title),
    })),
    active.key,
    props.selectedKey === active.key,
    (key) => {
      props.onDocumentTab(key);
      if (key === active.key) props.toggle(key);
      else props.select(key);
    },
    entryBody(`${id}-body`, active, props, { flexGrow: 1, flexShrink: 1 }),
  );
};

const entryCard = (
  entry: TicketContentEntry,
  selected: boolean,
  props: TicketContentProps,
): VNode => {
  const id = ticketContentRowId(entry.key);
  return Card({
    id,
    width: '100%',
    borderColor: selected ? FOREGROUND_HIGHLIGHT : BORDER,
    children: [
      h(
        BoxRenderable,
        {
          id: `${id}-header`,
          flexDirection: 'column',
          width: '100%',
          flexShrink: 0,
          paddingBottom: 1,
          onMouseDown: pressHandler(() =>
            activate(entry, props.select, props.toggle),
          ),
        },
        paragraphNode({
          id: `${id}-title-text`,
          runs: [plainRun(entry.title, BOLD)],
          fg: FOREGROUND,
        }),
        ...(entry.metadata !== undefined
          ? [
              paragraphNode({
                id: `${id}-metadata`,
                runs: [plainRun(entry.metadata, DIM)],
                fg: FOREGROUND,
              }),
            ]
          : []),
      ),
      h(
        BoxRenderable,
        {
          id: `${id}-body`,
          flexDirection: 'column',
          width: '100%',
          onMouseDown: pressHandler(INERT),
        },
        sectionBody(`${id}-body-content`, entry, props.expandedKeys),
      ),
    ],
  });
};

const properties = (
  id: string,
  items: readonly TicketProperty[],
  activateProperty: ((item: TicketProperty) => void) | undefined,
): VNode =>
  KeyValue({
    id,
    items: items.map((item) => {
      const linked = item.ticketId !== undefined || item.href !== undefined;
      return {
        key: item.key,
        value: item.value,
        underline: linked,
        ...(linked && activateProperty !== undefined
          ? { onMouseDown: () => activateProperty(item) }
          : {}),
      };
    }),
    keyColor: FOREGROUND,
    valueColor: FOREGROUND_HIGHLIGHT,
  });

const heatGrid = (id: string, grid: TicketHeatGrid): VNode | null => {
  if (grid.columns.length === 0 || grid.rows.length === 0) return null;
  return HeatMap({
    id,
    data: grid.rows.map((row) => row.cells.map((cell) => cell.value ?? 0)),
    rowLabels: grid.rows.map((row) => row.label),
    colLabels: grid.columns.map((column) => column.label),
    showValues: true,
  });
};

const ticketStats = (id: string, grid: TicketHeatGrid): VNode | null => {
  const row = grid.rows[0];
  if (grid.columns.length === 0 || row === undefined) return null;
  return KeyValue({
    id,
    items: grid.columns.map((column, index) => ({
      key: column.label,
      value: row.cells[index]?.display ?? 'none',
    })),
    keyColor: FOREGROUND,
    valueColor: FOREGROUND_HIGHLIGHT,
  });
};

const metricsMatrix = (id: string, matrix: TicketMetricMatrix): VNode => {
  const ticket = ticketStats(`${id}-ticket-values`, matrix.ticket);
  const runs = heatGrid(`${id}-runs-values`, matrix.runs);
  if (ticket === null && runs === null)
    return paragraphNode({
      id: `${id}-none`,
      runs: [plainRun('none')],
      fg: FOREGROUND_HIGHLIGHT,
      flexShrink: 0,
    });
  return column(
    id,
    { width: '100%', flexShrink: 0 },
    ...(ticket === null
      ? []
      : [
          HeadlineMarkdown({
            id: `${id}-ticket`,
            headline: 'ticket',
            children: [ticket],
          }),
        ]),
    ...(runs === null
      ? []
      : [
          HeadlineMarkdown({
            id: `${id}-runs`,
            headline: 'runs',
            children: [runs],
          }),
        ]),
  );
};

const sidebarCard = (
  id: string,
  sidebar: TicketSidebar,
  props: TicketContentProps,
): VNode => {
  // The Stats tab only exists once the ticket is done (`showMetrics`); until
  // then the sidebar opens on Details and never offers a Stats tab.
  const tabs = sidebar.showMetrics
    ? SIDEBAR_TABS
    : SIDEBAR_TABS.filter((item) => item.id !== 'stats');
  const requested = props.sidebarTab ?? defaultSidebarTab(sidebar);
  const tab = tabs.some((item) => item.id === requested)
    ? requested
    : defaultSidebarTab(sidebar);
  const pane = tab === 'related' ? sidebar.related : sidebar.details;
  return Card({
    id,
    width: '100%',
    paddingY: 1,
    borderColor:
      props.selectedKey === TECHNICAL_KEY ? FOREGROUND_HIGHLIGHT : BORDER,
    children: [
      // The row carries the Technical entry's id, which the kernel scrolls to;
      // the inner strip selects the entry and the tab labels pick a pane, each
      // consuming its own press.
      h(
        BoxRenderable,
        {
          id: ticketContentRowId(TECHNICAL_KEY),
          flexDirection: 'row',
          width: '100%',
          flexShrink: 0,
        },
        h(
          BoxRenderable,
          {
            id: `${id}-tabs`,
            flexDirection: 'row',
            width: '100%',
            flexShrink: 0,
            gap: 1,
            onMouseDown: pressHandler(() => props.select(TECHNICAL_KEY)),
          },
          ...tabs.map((item) =>
            tabLabel(
              `${id}-tab-${item.id}`,
              item.label,
              tab === item.id,
              tab === item.id ? FOREGROUND_HIGHLIGHT : FOREGROUND,
              () => {
                props.onSidebarTab(item.id);
                props.select(TECHNICAL_KEY);
              },
            ),
          ),
        ),
      ),
      column(
        `${id}-pane`,
        { width: '100%', flexShrink: 0, marginTop: 1, gap: 1 },
        tab === 'stats'
          ? metricsMatrix(`${id}-metrics`, sidebar.matrix)
          : properties(`${id}-properties-${tab}`, pane, props.activateProperty),
      ),
    ],
  });
};

/**
 * The row id a Tab/arrow-key visit lands on for the inline messages card —
 * exported so the screen can add it to `selectableKeys` and open the full
 * send/poll screen on Enter, the same way Details/Stats/Related are reached
 * by keyboard even though their own pane switching stays mouse-only.
 */
export const ADDONS_KEY = 'addons-card';

/** Whether the preview has at least one message worth a keyboard stop. */
export const hasAddonsMessages = (preview: TicketAddons): boolean =>
  preview.addons.some((addon) => addon.messages.length > 0);

/**
 * The ticket's conductor-run messages (BB-661): one pressable line per
 * message, opening the full send/poll screen, and the requester's own latest
 * answer as a one-line preview. Nothing here ever reads "addon".
 */
const addonsCard = (
  id: string,
  preview: TicketAddons,
  onOpen: (() => void) | undefined,
  selected: boolean,
): VNode | null => {
  if (preview.addons.length === 0) return null;
  const lines: VNode[] = [];
  for (const addon of preview.addons) {
    for (const message of addon.messages) {
      lines.push(
        paragraphNode({
          id: `${id}-${addon.name}-${message.key}`,
          runs: [plainRun(message.label)],
          fg: FOREGROUND_HIGHLIGHT,
          onMouseDown: onOpen,
        }),
      );
    }
    const result = addon.latest?.result;
    const answer =
      addon.contract === 2 && result && 'markdown' in result
        ? result.markdown.split('\n')[0]
        : undefined;
    // The same wording as the Web card: never another requester's answer.
    const markdown =
      addon.messages.length > 0 && !addon.latest
        ? 'You have not sent a message to this addon.'
        : answer === ''
          ? 'Completed without a response.'
          : answer;
    if (markdown)
      lines.push(
        paragraphNode({
          id: `${id}-${addon.name}-latest`,
          runs: [plainRun(markdown, DIM)],
          fg: FOREGROUND,
        }),
      );
  }
  if (lines.length === 0) return null;
  return Card({
    id: ticketContentRowId(ADDONS_KEY),
    width: '100%',
    paddingY: 1,
    borderColor: selected ? FOREGROUND_HIGHLIGHT : BORDER,
    children: lines,
  });
};

const linksSection = (
  id: string,
  links: readonly TicketProperty[],
  activateProperty: ((item: TicketProperty) => void) | undefined,
): VNode | null => {
  // Drop the `none` placeholder linkProperties emits for a linkless ticket, so
  // the section is omitted entirely rather than painting "links : none".
  const real = links.filter(
    (item) => item.value !== 'none' && item.value !== '',
  );
  if (real.length === 0) return null;
  return HeadlineMarkdown({
    id,
    headline: 'links',
    paddingBottom: 1,
    children: [properties(`${id}-items`, real, activateProperty)],
  });
};

/**
 * ONE tree for both widths: side by side at 100 columns and wider, stacked
 * below. Only layout props differ between the two, so a resize across the
 * breakpoint patches them instead of rebuilding nodes that keep their row ids.
 */
const overview = (id: string, props: TicketContentProps): VNode => {
  const { model } = props;
  const wide = props.terminalColumns >= WIDE_OVERVIEW_COLUMNS;
  const main = model.entries.filter((entry) => entry.key !== TECHNICAL_KEY);
  const links = linksSection(
    `${id}-links`,
    model.sidebar?.links ?? [],
    props.activateProperty,
  );
  const sidebar =
    model.sidebar === undefined
      ? null
      : sidebarCard(`${id}-sidebar`, model.sidebar, props);
  const addons = props.addonsPreview
    ? addonsCard(
        `${id}-addons`,
        props.addonsPreview,
        props.onOpenAddons,
        props.selectedKey === ADDONS_KEY,
      )
    : null;
  const side = sidebar === null && addons === null ? null : [sidebar, addons];
  const sideBySide = wide && side !== null;
  return h(
    BoxRenderable,
    {
      id,
      flexDirection: sideBySide ? 'row' : 'column',
      width: '100%',
      flexGrow: 1,
      flexShrink: 1,
      gap: 2,
    },
    column(
      `${id}-main`,
      {
        width: sideBySide ? 'auto' : '100%',
        flexGrow: 1,
        // Side by side it yields WIDTH to the sidebar; stacked, nothing may
        // squeeze its height below the documents it holds.
        flexShrink: sideBySide ? 1 : 0,
        gap: sideBySide ? 0 : 2,
      },
      overviewDocuments(`${id}-documents`, main, props),
      ...(links === null ? [] : [links]),
    ),
    ...(side === null
      ? []
      : [
          column(
            `${id}-side`,
            { width: sideBySide ? '30%' : '100%', flexShrink: 0, gap: 1 },
            ...side.filter((node): node is VNode => node !== null),
          ),
        ]),
  );
};

export function TicketContent(props: TicketContentProps): VNode {
  const { id, model, tab } = props;
  if (tab === 'comments' && model.entries.length === 0)
    return column(
      id,
      { width: '100%', flexGrow: 1, flexShrink: 1 },
      paragraphNode({
        id: `${id}-empty`,
        runs: [plainRun('No comments.')],
        fg: FOREGROUND,
        width: '100%',
      }),
    );
  if (tab === 'overview') return overview(`${id}-overview`, props);
  if (tab === 'planning')
    return documentPane(`${id}-planning`, model.entries, props);
  return column(
    `${id}-history`,
    { width: '100%', flexGrow: 1, flexShrink: 1, gap: 1 },
    ...model.entries.map((entry) =>
      entryCard(entry, props.selectedKey === entry.key, props),
    ),
  );
}
