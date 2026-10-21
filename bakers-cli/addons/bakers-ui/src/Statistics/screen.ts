import { BoxRenderable, h, type VNode } from '@opentui/core';
import {
  filterBadgeStrip,
  type ListFilterBadge,
} from '../Component/list-chrome/index.js';
import type { SectionRow } from '../Component/section-list/index.js';
import { tabPartsFor } from '../Component/top-tabs/index.js';
import { FOREGROUND, paragraphNode, plainRun } from '../lib/vnode.js';
import type { FullScreenChrome } from '../Screen/async-screen.js';
import { AsyncScreen } from '../Screen/async-screen.js';
import type { ScreenContext } from '../Screen/screen.js';
import type {
  GroupStatisticsResult,
  StatisticFigureGroup,
  StatisticsFilters,
} from './client.js';
import { StatisticsFigures } from './figures.js';
import { groupedFigureLines } from './presentation.js';

/** Grid width before the first layout has measured one — a pipe's width. */
const DEFAULT_COLUMNS = 80;

export abstract class StatisticsScreen<T> extends AsyncScreen<T> {
  readonly bodyFrame = false;
  /** The figure grid's laid-out width, as the layout last reported it. */
  private gridWidth: number | undefined;
  private period: string | undefined;
  // BB-548 addendum 5: each figure group (Overview, Breakdown, Tickets,
  // Runs, Tokens) is its own navigable sub-tab within the Stats screen,
  // switched with Left/Right (the same "left"/"right" key names
  // list-screen.ts uses for pagination) — not stacked sections. The server
  // already omits empty groups, so the active tab tracks a group id rather
  // than a fixed index.
  private activeGroupId: string | undefined;
  protected abstract statistics(value: T): GroupStatisticsResult;
  protected abstract readyRows(value: T, context: ScreenContext): SectionRow[];
  protected chrome(_context: ScreenContext): FullScreenChrome {
    return {};
  }

  private groups(value: T) {
    const result = this.statistics(value);
    return result.kind === 'ok' ? result.groups : [];
  }

  // BB-548 addendum 6: Overview is a fixed-window figure group with no
  // category axis and no reaction to period/granularity — it renders
  // unconditionally above the chip bar and tab group, not as a switchable
  // tab among them.
  private overviewGroup(value: T) {
    return this.groups(value).find((group) => group.id === 'overview');
  }

  private tabbedGroups(value: T) {
    return this.groups(value).filter((group) => group.id !== 'overview');
  }

  private activeGroup(value: T) {
    const groups = this.tabbedGroups(value);
    if (groups.length === 0) return undefined;
    return groups.find((group) => group.id === this.activeGroupId) ?? groups[0];
  }

  private shiftActiveGroup(value: T, direction: 1 | -1): boolean {
    const groups = this.tabbedGroups(value);
    if (groups.length < 2) return false;
    const current = this.activeGroup(value);
    const index = current
      ? groups.findIndex((group) => group.id === current.id)
      : 0;
    const next = groups[(index + direction + groups.length) % groups.length];
    this.activeGroupId = next?.id;
    return true;
  }

  protected statisticsFilters(): StatisticsFilters {
    const filters: StatisticsFilters = {};
    if (this.period !== undefined) filters.period = this.period;
    return filters;
  }

  /**
   * Maps a preset's raw period value to the granularity legible label
   * (BB-548 scope change 7): `7`/`30` are daily buckets, `365` is monthly.
   */
  private static rangeLabel(value: string): string {
    return value === '365' ? '1y·monthly' : `${value}d·daily`;
  }

  private periodFilter(): { value: string; options: string[] } | undefined {
    const result =
      this.readyValue === undefined
        ? undefined
        : this.statistics(this.readyValue);
    if (result?.kind !== 'ok') return undefined;
    for (const group of result.groups) {
      for (const figure of group.figures) {
        const filter = figure.filters.period;
        if (filter)
          return {
            value: filter.value,
            options: filter.options.map((option) => option.value),
          };
      }
    }
    return undefined;
  }

  /**
   * One boxed filter chip cycling the three fixed period+granularity presets
   * (BB-548 scope change 7, replacing the former two independent
   * period/granularity chips of addendum 4). Rendered via
   * `filterBadgeStrip` inside `renderReady`, below Overview — see the
   * override of {@link badges} just below for why.
   */
  private statisticsBadges(): readonly ListFilterBadge[] {
    const period = this.periodFilter();
    if (!period) return [];
    return [
      {
        id: 'period',
        label: `t Range(${StatisticsScreen.rangeLabel(period.value)})`,
      },
    ];
  }

  // BB-548 addendum 6: AsyncScreen's own `badges()` hook renders its strip
  // above the ENTIRE body, which would put it above Overview too. Suppress it
  // here; `renderReady` renders the same data (statisticsBadges()) itself,
  // positioned below Overview.
  protected override badges(): readonly ListFilterBadge[] {
    return [];
  }

  /**
   * Both grids share one measured width. A report of a new width is drawn on
   * the next turn, never from inside the layout pass that reported it.
   */
  private figures(
    id: string,
    groups: StatisticFigureGroup[],
    context: ScreenContext,
  ): VNode {
    return StatisticsFigures({
      id,
      groups,
      width: this.gridWidth ?? context.terminalColumns ?? DEFAULT_COLUMNS,
      onResize: (width) => {
        if (width <= 0 || width === this.gridWidth) return;
        this.gridWidth = width;
        queueMicrotask(() => this.requestActiveDraw(context));
      },
    });
  }

  protected renderReady(value: T, context: ScreenContext): VNode {
    const overview = this.overviewGroup(value);
    const groups = this.tabbedGroups(value);
    const active = this.activeGroup(value);
    const tabBar =
      groups.length > 1 && active
        ? tabPartsFor({
            level: 'stats',
            tab: active.id,
            tabs: groups.map((group) => ({ id: group.id, label: group.label })),
          })
        : undefined;
    const badges = this.statisticsBadges();
    const line = (id: string, text: string) =>
      paragraphNode({ id, runs: [plainRun(text)], fg: FOREGROUND });
    return h(
      BoxRenderable,
      {
        id: `${this.id}-statistics`,
        flexDirection: 'column',
        width: '100%',
        gap: 1,
      },
      ...this.readyRows(value, context).map((row) =>
        line(`${this.id}-row-${row.key}`, row.text),
      ),
      // Overview renders first, unconditionally, outside the tab group and
      // with no chip bar above it (it reacts to neither period nor
      // granularity) — BB-548 addendum 6.
      ...(overview
        ? [this.figures('statistics-overview-grid', [overview], context)]
        : []),
      ...(badges.length > 0
        ? [filterBadgeStrip(`${this.id}-filter`, badges)]
        : []),
      ...(tabBar
        ? [
            line(
              `${this.id}-group-tabs`,
              tabBar.map((part) => part.text).join(''),
            ),
          ]
        : []),
      ...(active ? [this.figures('statistics-grid', [active], context)] : []),
    );
  }

  protected readyLines(value: T, context: ScreenContext): string[] {
    const statistics = this.statistics(value);
    return [
      ...this.readyRows(value, context).map((row) => row.text),
      ...(statistics.kind === 'ok'
        ? groupedFigureLines(statistics.groups)
        : []),
    ];
  }

  override handleInput(key: string, context: ScreenContext): boolean {
    if (key === 'left' || key === 'right') {
      if (
        this.readyValue !== undefined &&
        this.shiftActiveGroup(this.readyValue, key === 'right' ? 1 : -1)
      ) {
        context.requestDraw();
        return true;
      }
    }
    if (key === 't') {
      const filter = this.periodFilter();
      const options = filter?.options ?? [];
      if (options.length > 1) {
        const index = options.indexOf(this.period ?? filter?.value ?? '');
        this.period = options[(index + 1) % options.length] ?? options[0];
        this.retry(context);
        return true;
      }
    }
    return super.handleInput(key, context);
  }

  renderNonInteractive(context: ScreenContext): string[] {
    return this.readyValue === undefined
      ? (this.noticeRows(context) ?? [])
      : this.readyLines(this.readyValue, context);
  }

  override leave() {
    this.period = undefined;
    this.activeGroupId = undefined;
    super.leave();
  }

  override reset() {
    this.period = undefined;
    this.activeGroupId = undefined;
    super.reset();
  }
}
