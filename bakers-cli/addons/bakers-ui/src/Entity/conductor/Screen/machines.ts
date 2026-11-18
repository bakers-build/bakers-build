import { actionItem } from '../../../Component/footer-actions/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { confirmNavigation } from '../../../Screen/confirm-dialog.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import type { Page } from '../../collection.js';
import { OwnerIdentity } from '../Data/own-rows.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import {
  listMachineRows,
  MACHINE_TABLE,
  type MachineRow,
} from '../Data/machines.js';
import { restartRunsRequest } from './restart-runs.js';

/**
 * Machines — the root level of the conductor cockpit: the operator's
 * machines, each opening its conductors. `r` restarts the runs of an owned
 * machine behind a confirmation.
 */
export class MachinesScreen extends ListScreen<MachineRow> {
  static readonly route = {
    id: 'machines',
    path: '/machines',
    tab: { id: 'machines', label: 'Machines', scope: 'root', weight: 50 },
  } satisfies RouteMetadata;
  readonly id = MachinesScreen.route.id;
  readonly frameId = 'machines';
  protected readonly table = MACHINE_TABLE;
  private readonly identity = new OwnerIdentity(resolveWhoCandidate);
  private ownerId: string | undefined;

  protected tableContext(): void {}

  protected async loadRows(context: ScreenContext): Promise<Page<MachineRow>> {
    if (!context.services) throw new Error('Machines requires services');
    const client = context.services.client;
    const outcome = await this.identity.resolve(
      client,
      context.services.currentUser,
    );
    this.ownerId = outcome.kind === 'resolved' ? outcome.id : undefined;
    return listMachineRows(
      client,
      this.ownerId,
      context.nowSeconds?.() ?? Math.floor(Date.now() / 1000),
    );
  }

  protected renderLoading(): string[] {
    return ['Loading machines…'];
  }

  protected chrome(): FullScreenChrome {
    return {
      selectable: this.rows.length,
      selectedIndex: this.selectedIndex,
      rowIds: this.rowNodeIds,
      title: 'bakers.build machines',
      meta: this.countLabel(),
    };
  }

  /** Restart runs only on a machine the operator owns. */
  private owned(): MachineRow | undefined {
    const row = this.rows[this.selectedIndex];
    return row && this.ownerId && row.ownerUserId === this.ownerId
      ? row
      : undefined;
  }

  protected actions() {
    return [
      ...(this.owned() ? [actionItem('machines-restart', 'r', 'restart runs')] : []),
      actionItem('machines-enter', 'Enter', 'conductors'),
      actionItem('machines-tab', 'Tab', 'tabs'),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const row = this.rows[index];
    if (!row || !context.navigate) return false;
    context.navigate('conductors', { machineId: row.id });
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    return this.handleCursorInput(input, context);
  }

  actionForInput(input: string): ScreenAction | undefined {
    const row = input === 'r' ? this.owned() : undefined;
    if (!row) return undefined;
    return confirmNavigation(
      restartRunsRequest({
        level: 'machine',
        label: row.name,
        conductorIds: row.conductorIds,
        online: row.online,
      }),
    );
  }

  override reset(): void {
    this.resetList();
    this.identity.reset();
    this.ownerId = undefined;
    super.reset();
  }
}
