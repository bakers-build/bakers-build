import { actionItem } from '../../../Component/footer-actions/index.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import { ListScreen } from '../../../Screen/list-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import type { Page } from '../../collection.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import {
  listMachineRows,
  MACHINE_TABLE,
  type MachineRow,
} from '../Data/machines.js';
import { OwnerIdentity } from '../Data/own-rows.js';

/**
 * Machines — the root level of the conductor cockpit: the operator's
 * machines, each opening its machine detail (Overview, Conductors), where
 * Restart runs lives.
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

  protected actions() {
    return [
      actionItem('machines-enter', 'Enter', 'open'),
      actionItem('machines-tab', 'Tab', 'tabs'),
    ];
  }

  activate(index: number, context: ScreenContext): boolean {
    const row = this.rows[index];
    if (!row || !context.navigate) return false;
    context.navigate('machine.overview', { machineId: row.id });
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    if (input === 'enter') return this.activate(this.selectedIndex, context);
    return this.handleCursorInput(input, context);
  }

  override reset(): void {
    this.resetList();
    this.identity.reset();
    this.ownerId = undefined;
    super.reset();
  }
}
