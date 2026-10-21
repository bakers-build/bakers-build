import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { actionItem } from '../Component/footer-actions/index.js';
import { lineText, type SectionRow } from '../Component/section-list/index.js';
import { statsPanelRows } from '../Component/stats-panel/index.js';
import type { RouteMetadata } from '../Routing/route.js';
import type { FullScreenChrome } from '../Screen/full-screen.js';
import type { ScreenAction, ScreenContext } from '../Screen/screen.js';
import type { DropshClient } from '../types.js';
import {
  errorResultOf,
  type GroupStatisticsResult,
  loadGroupStatistics,
} from './client.js';
import { groupedFigureLines } from './presentation.js';
import { StatisticsScreen } from './screen.js';

// BB-456 — Stats reads the configured-figure contract (spec D5),
// replacing the workspace-wide document BB-256/271/319/321/377 built. A
// project renders its own composite figures; the root screen — no project in
// context — renders the account's
// OWN figures instead of a workspace-wide total, because there are no
// workspace statistics any more (spec D6). Neither screen holds a list of
// figures: the server names their widgets and supplies complete datasets.
//
// DROPPED, and deliberately: the old PER USER cursor that navigated to a
// user's overview from a clicked row. It read `by_user` off the fixed
// document; the composite contract exposes categories inside each figure,
// and the shipped project-scope overview has no member navigation axis; a
// per-user breakdown now lives at TEAM scope). Re-introducing the
// interaction needs a figure and a contract addition, not a client fix.

/** Rows that are plain text, keyed under one name: a failure or empty state. */
const plainRows = (key: string, lines: string[]): SectionRow[] =>
  lines.map((text, index) => ({ key: `${key}-${index}`, text, bold: false }));

/** The Tab hint is a TERMINAL affordance; a pipe has no tabs (spec D9). */
const withoutTabHint = (lines: string[]): string[] =>
  lines.filter((line) => !line.startsWith('Press Tab'));

/**
 * Resolves a username-like identifier to the `user` entity's own uuid.
 *
 * Deliberately NOT a call into `Entity/user/Data/`: entity screens consume the
 * Statistics domain module, while the module imports no entity slices. Keeping
 * that direction prevents a cycle and leaves the query small enough to own here
 * rather than inventing a shared abstraction for one lookup.
 */
async function resolveCurrentUserId(
  client: DropshClient,
  name: string,
): Promise<string | undefined> {
  const params = new DrupalJsonApiParams();
  params.addFilter('name', name);
  params.addPageLimit(1);
  const doc = (await client.get('user/user', params)) as {
    data?: Array<{ id?: string }>;
  };
  return doc?.data?.[0]?.id;
}

type ScopeResult =
  | { id: string }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

abstract class StatsScreen extends StatisticsScreen<GroupStatisticsResult> {
  readonly frameId = 'dashboard';
  reload(context: ScreenContext): void {
    this.retry(context);
  }
  private status = '';
  actionForInput(
    input: string,
    context: ScreenContext,
  ): ScreenAction | undefined {
    if (input !== 'n') return undefined;
    if (!context.services?.agents) {
      this.status = 'create agent unavailable — no agent host injected';
      context.requestDraw();
      return { type: 'redraw' };
    }
    return {
      type: 'navigate',
      routeId: 'ticket.create',
      params: context.project
        ? {
            projectId: context.project.id,
            projectName: context.project.name,
            projectSlug: context.project.slug,
          }
        : {},
    };
  }
  /**
   * Resolves the group this dashboard reads: the open project, or — at root
   * — the account's own uuid, resolved from `services.currentUser` (a
   * username-like identifier, not the entity uuid the statistics route
   * needs).
   *
   * The account lookup can fail the same three ways a statistics read can —
   * an outdated control plane, a real outage, or (uniquely to this step) the
   * account itself not resolving — and each must stay legible and
   * distinguishable (spec/plan stage 8). A thrown failure is classified with
   * the identical `unsupported`/`error` split the statistics reads use,
   * rather than left to propagate into a screen's generic catch-all, which
   * has no such distinction.
   */
  protected abstract resolveScopeId(
    context: ScreenContext,
  ): Promise<ScopeResult>;

  protected async resolveCurrentUserScope(
    context: ScreenContext,
  ): Promise<ScopeResult> {
    const services = context.services;
    if (!services) {
      return { kind: 'error', message: 'no services injected' };
    }
    const name = services.currentUser ?? '';
    try {
      const id = await resolveCurrentUserId(services.client, name);
      if (id === undefined) {
        return {
          kind: 'error',
          message: `current account '${name}' not found`,
        };
      }
      return { id };
    } catch (caught) {
      return errorResultOf(caught);
    }
  }
  protected async load(context: ScreenContext): Promise<GroupStatisticsResult> {
    if (!context.services) throw new Error('Stats requires services');
    const scope = await this.resolveScopeId(context);
    if ('id' in scope) {
      return loadGroupStatistics(
        context.services.client,
        context.project ? { project: scope.id } : { user: scope.id },
        this.statisticsFilters(),
      );
    }
    return scope;
  }
  protected renderLoading(): string[] {
    return ['Loading stats…'];
  }
  protected readyRows(
    result: GroupStatisticsResult,
    context: ScreenContext,
  ): SectionRow[] {
    if (result.kind === 'unsupported')
      return plainRows('unsupported', [
        'This control plane does not serve /jsonapi/bakers/statistics.',
        '',
        'It predates BB-456. Deploy it to see the figures.',
        '',
        `Press Tab for ${context.project ? 'Tickets' : 'Projects'}.`,
      ]);
    if (result.kind === 'error')
      return plainRows('error', [
        'Could not read /jsonapi/bakers/statistics.',
        '',
        result.message,
      ]);
    if (result.groups.length === 0)
      return plainRows(
        'empty',
        statsPanelRows([], {
          emptyMessage: 'No figures configured for this group.',
        }).map(lineText),
      );
    return [];
  }

  protected statistics(value: GroupStatisticsResult) {
    return value;
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const result = this.readyValue;
    const name = context.project?.name ?? context.project?.slug;
    const stats =
      result?.kind === 'ok'
        ? `${result.groups.reduce((sum, group) => sum + group.figures.length, 0)} figure(s)`
        : this.state === 'loading'
          ? 'loading…'
          : result === undefined
            ? 'no figures read'
            : 'statistics unavailable';
    return {
      title: name ? `${name} · stats` : 'bakers.build stats',
      meta: stats,
    };
  }

  protected actions() {
    return [
      actionItem('stats-new', 'n', 'new'),
      actionItem('stats-tab', 'Tab', 'tabs'),
    ];
  }

  protected notice(): string | undefined {
    return this.status || undefined;
  }

  /**
   * F5 — the pipe's own output, and it stays `string[]`.
   *
   * Projected from the same figure model, so the pipe
   * never has to walk the tree {@link renderReady} builds — the native
   * renderer that tree needs is never constructed for a non-interactive read
   * at all.
   */
  renderNonInteractive(context: ScreenContext): string[] {
    const result = this.readyValue;
    if (result?.kind === 'ok' && result.groups.length > 0) {
      return groupedFigureLines(result.groups);
    }
    if (result !== undefined)
      return withoutTabHint(
        this.readyRows(result, context).map((row) => row.text),
      );
    return withoutTabHint(this.noticeRows(context) ?? []);
  }

  nonInteractive(context: ScreenContext) {
    const result = this.readyValue;
    const failed = result?.kind === 'unsupported' || result?.kind === 'error';
    return {
      lines: [
        this.present(context).title ?? '',
        ...this.renderNonInteractive(context),
      ].filter(Boolean),
      ...(failed ? { stream: 'stderr' as const, exitCode: 1 } : {}),
    };
  }

  override reset(): void {
    this.status = '';
    super.reset();
  }
}

export class MyStatsScreen extends StatsScreen {
  static readonly route = {
    id: 'my.stats',
    path: '/stats',
    tab: { id: 'stats', label: 'Stats', scope: 'root', weight: 10 },
    fallback: { routeId: 'my.work' },
  } satisfies RouteMetadata;
  readonly id = MyStatsScreen.route.id;

  protected resolveScopeId(context: ScreenContext): Promise<ScopeResult> {
    return this.resolveCurrentUserScope(context);
  }
}

export class ProjectStatsScreen extends StatsScreen {
  static readonly route = {
    id: 'project.stats',
    path: '/projects/:projectId/stats',
    tab: { id: 'stats', label: 'Stats', scope: 'project', weight: 10 },
    fallback: { routeId: 'project.overview', preserveParams: true },
  } satisfies RouteMetadata;
  readonly id = ProjectStatsScreen.route.id;

  protected resolveScopeId(context: ScreenContext): Promise<ScopeResult> {
    const projectId = context.project?.id ?? context.params?.projectId;
    return Promise.resolve(
      projectId
        ? { id: projectId }
        : { kind: 'error', message: 'Project Stats requires projectId' },
    );
  }
}
