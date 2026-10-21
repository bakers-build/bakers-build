import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import {
  sectionRowNode,
  sectionRows,
} from '../../../Component/section-list/index.js';
import { workloadSummaryRows } from '../../../Component/workload-summary/index.js';
import { columnNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import {
  loadProjectWorkload,
  type ProjectWorkContext,
  type ProjectWorkloadResult,
} from '../Data/workload.js';

const contextLines = (project: ProjectWorkContext): string[] => [
  ...(project.key ? [`Key: ${project.key}`] : []),
  ...(project.group ? [`Group: ${project.group}`] : []),
  ...(project.teams.length > 0 ? [`Teams: ${project.teams.join(', ')}`] : []),
  ...(project.repository ? [`Repository: ${project.repository}`] : []),
];

/**
 * The project landing tab: project context and a current-work summary.
 *
 * The per-ticket lists live on the Tickets tab; this overview carries only the
 * project's identity and the open/running/waiting/unassigned counts.
 */
export class ProjectOverviewScreen extends AsyncScreen<ProjectWorkloadResult> {
  readonly frameId = 'project-overview';
  static readonly route = {
    id: 'project.overview',
    path: '/projects/:projectId',
    tab: { id: 'overview', label: 'Overview', scope: 'project', weight: 1 },
    fallback: { routeId: 'projects' },
  } satisfies RouteMetadata;
  readonly id = ProjectOverviewScreen.route.id;

  reload(context: ScreenContext): void {
    this.retry(context);
  }

  protected load(context: ScreenContext): Promise<ProjectWorkloadResult> {
    if (!context.services)
      throw new Error('Project Overview requires services');
    const projectId = context.project?.id ?? context.params?.projectId;
    if (!projectId) throw new Error('Project Overview requires projectId');
    return loadProjectWorkload(context.services.client, projectId);
  }

  protected renderLoading(): string[] {
    return ['Loading project overview…'];
  }

  protected renderReady(result: ProjectWorkloadResult): VNode {
    const rows = [
      ...sectionRows([
        { heading: 'Project', lines: contextLines(result.project) },
      ]),
      ...sectionRows([
        {
          heading: 'Current work',
          lines: workloadSummaryRows([
            ['Open', result.workload.open.length],
            ['Running', result.workload.running.length],
            ['Waiting', result.workload.waiting.length],
            ['Unassigned', result.workload.unassigned.length],
          ]),
        },
      ]),
    ].map((row) => sectionRowNode('project-overview', row));
    return columnNode('project-overview', ...rows);
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const name =
      this.readyValue?.project.name ??
      context.project?.name ??
      context.params?.projectName ??
      context.params?.projectSlug ??
      context.params?.projectId ??
      'project';
    return {
      title: `${name} · overview`,
      meta: `${this.readyValue?.workload.open.length ?? 0} open ticket(s)  ·  ${context.services?.baseUrl ?? ''}`,
    };
  }

  protected actions() {
    return [actionItem('project-overview-tab', 'Tab', 'tabs')];
  }
}
