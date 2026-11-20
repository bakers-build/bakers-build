import type { VNode } from '@opentui/core';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { columnNode, textNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import { confirmNavigation } from '../../../Screen/confirm-dialog.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import { listMachineRows, type MachineRow } from '../Data/machines.js';
import { OwnerIdentity } from '../Data/own-rows.js';
import { restartRunsRequest } from './restart-runs.js';

/** `bakers.build machine — <name>` — the title every tab of the scope shares. */
export const machineTitle = (machine: Pick<MachineRow, 'name'> | undefined) =>
  `bakers.build machine — ${machine?.name ?? ''}`;

const machineOverviewRows = (machine: MachineRow): string[] => [
  `Status: ${machine.online ? 'online' : 'offline'}`,
  `Host key: ${machine.hostKey || '—'}`,
  `Active runs: ${machine.active}`,
  `Conductors: ${machine.conductorIds.length}`,
];

/**
 * Overview — the machine detail scope's landing tab, opened from the
 * Machines list. `r` restarts the runs of a machine the operator owns,
 * behind a confirmation.
 */
export class MachineOverviewScreen extends AsyncScreen<MachineRow> {
  static readonly route = {
    id: 'machine.overview',
    path: '/machines/:machineId',
    parent: 'machines',
    tab: { id: 'overview', label: 'Overview', scope: 'machine', weight: 10 },
    fallback: { routeId: 'machines' },
  } satisfies RouteMetadata;
  readonly id = MachineOverviewScreen.route.id;
  readonly frameId = 'machine';
  private readonly identity = new OwnerIdentity(resolveWhoCandidate);
  private ownerId: string | undefined;

  protected async load(context: ScreenContext): Promise<MachineRow> {
    if (!context.services) throw new Error('Machine requires services');
    const client = context.services.client;
    const outcome = await this.identity.resolve(
      client,
      context.services.currentUser,
    );
    this.ownerId = outcome.kind === 'resolved' ? outcome.id : undefined;
    const machineId = context.params?.machineId ?? '';
    const { rows } = await listMachineRows(
      client,
      undefined,
      context.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
      machineId,
    );
    const machine = rows.find((row) => row.id === machineId);
    if (!machine) throw new Error('Machine not found');
    return machine;
  }

  reload(context: ScreenContext): Promise<void> {
    return this.retry(context);
  }

  protected renderLoading(): string[] {
    return ['Loading machine…'];
  }

  protected renderReady(machine: MachineRow): VNode {
    return columnNode(
      'machine-overview',
      ...machineOverviewRows(machine).map((line, index) =>
        textNode({ id: `machine-overview-${index}`, content: line }),
      ),
    );
  }

  protected chrome(): FullScreenChrome {
    return { title: machineTitle(this.readyValue) };
  }

  /** Restart runs only on a machine the operator owns. */
  private owned(): MachineRow | undefined {
    const machine = this.readyValue;
    return machine && this.ownerId && machine.ownerUserId === this.ownerId
      ? machine
      : undefined;
  }

  protected actions() {
    return this.owned()
      ? [actionItem('machine-restart', 'r', 'restart runs')]
      : [];
  }

  actionForInput(input: string): ScreenAction | undefined {
    const machine = input === 'r' ? this.owned() : undefined;
    if (!machine) return undefined;
    return confirmNavigation(
      restartRunsRequest({
        level: 'machine',
        label: machine.name,
        args: { machine_id: machine.hostKey },
        online: machine.online,
      }),
    );
  }

  receiveResult(result: unknown, context: ScreenContext): void {
    if ((result as { type?: unknown } | undefined)?.type === 'runs-restarted')
      void this.reload(context);
  }

  renderNonInteractive(): string[] {
    return this.readyValue ? machineOverviewRows(this.readyValue) : [];
  }

  override reset(): void {
    this.identity.reset();
    this.ownerId = undefined;
    super.reset();
  }
}
