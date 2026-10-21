import type { ListFilterBadge } from '../../../Screen/full-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import {
  CLOSED_FILTER_VALUES,
  cycleValue,
  DEFAULT_TICKET_CRITERIA,
  type TicketCriteria,
} from '../Data/query.js';
import type { TicketRow } from '../Data/tickets.js';

export type FilterKey =
  | 'search'
  | 'state'
  | 'parent'
  | 'project'
  | 'who'
  | 'mine'
  | 'closed'
  | 'clear';

export interface TicketFilterBarHost {
  readonly criteria: TicketCriteria;
  setCriteria(next: TicketCriteria, context: ScreenContext): void;
  resolveMine(): { id: string; label: string } | null | undefined;
  toggleMine?(context: ScreenContext): void;
  /**
   * Optional: when set, the bar's `r` key calls this with the screen context,
   * returning `true` to claim the key. When absent, `r` is inert. TicketsScreen
   * does not implement it; MyWorkScreen does — `r` is a My-work-only affordance.
   */
  navigateToProjectFilter?(context: ScreenContext): boolean;
}

export class TicketFilterBar {
  constructor(
    private readonly host: TicketFilterBarHost,
    private readonly disable: ReadonlySet<FilterKey> = new Set(),
  ) {}

  get criteria(): TicketCriteria {
    return this.host.criteria;
  }

  badges(): readonly ListFilterBadge[] {
    const mineOn =
      !this.disable.has('mine') &&
      this.host.resolveMine() != null &&
      this.host.criteria.who?.id === this.host.resolveMine()?.id;
    const badge = (
      id: string,
      label: string,
      value?: string,
    ): ListFilterBadge => (value ? { id, label, value } : { id, label });
    const badges: ListFilterBadge[] = [];
    if (!this.disable.has('search'))
      badges.push(
        badge(
          'search',
          '/ search',
          this.host.criteria.query
            ? `search: ${this.host.criteria.query}`
            : undefined,
        ),
      );
    if (!this.disable.has('state'))
      badges.push(
        badge(
          'state',
          's state',
          this.host.criteria.state
            ? `state: ${this.host.criteria.state}`
            : undefined,
        ),
      );
    if (!this.disable.has('who'))
      badges.push(
        badge(
          'who',
          'w who',
          this.host.criteria.who
            ? `who: ${this.host.criteria.who.label}`
            : undefined,
        ),
      );
    if (!this.disable.has('mine'))
      badges.push(badge('mine', 'm mine', mineOn ? 'mine' : undefined));
    if (!this.disable.has('parent'))
      badges.push(
        badge(
          'parent',
          'p parent',
          this.host.criteria.parent
            ? `parent: ${this.host.criteria.parent.identifier}`
            : undefined,
        ),
      );
    if (!this.disable.has('project'))
      badges.push(
        badge(
          'project',
          'r project',
          this.host.criteria.project
            ? `project: ${this.host.criteria.project.label}`
            : undefined,
        ),
      );
    if (!this.disable.has('closed'))
      badges.push(
        badge(
          'closed',
          'x closed',
          this.host.criteria.closed === null
            ? undefined
            : this.host.criteria.closed
              ? 'closed: only'
              : 'closed: hidden',
        ),
      );
    if (!this.disable.has('clear')) badges.push(badge('clear', 'c clear'));
    return badges;
  }

  handleKey(input: string, context: ScreenContext): boolean {
    if (!this.disable.has('clear') && input === 'c') {
      this.host.setCriteria({ ...DEFAULT_TICKET_CRITERIA }, context);
      return true;
    }
    if (!this.disable.has('closed') && input === 'x') {
      this.host.setCriteria(
        {
          ...this.host.criteria,
          closed: cycleValue(CLOSED_FILTER_VALUES, this.host.criteria.closed),
        },
        context,
      );
      return true;
    }
    if (!this.disable.has('state') && input === 's') {
      this.host.setCriteria(
        {
          ...this.host.criteria,
          state: cycleValue(
            [
              'triage',
              'backlog',
              'todo',
              'spec',
              'diagnose',
              'coding',
              'review',
              'done',
              'cancelled',
            ],
            this.host.criteria.state,
          ),
        },
        context,
      );
      return true;
    }
    if (!this.disable.has('who') && input === 'w') {
      context.navigate?.('project.tickets.who-filter', context.params ?? {});
      return true;
    }
    if (!this.disable.has('mine') && input === 'm') {
      if (this.host.toggleMine) {
        this.host.toggleMine(context);
      } else {
        const mine = this.host.resolveMine();
        if (mine != null) {
          this.host.setCriteria(
            {
              ...this.host.criteria,
              who: this.host.criteria.who?.id === mine.id ? null : mine,
            },
            context,
          );
        }
      }
      return true;
    }
    if (!this.disable.has('parent') && input === 'p') {
      context.navigate?.('project.tickets.parent-filter', context.params ?? {});
      return true;
    }
    if (!this.disable.has('project') && input === 'r') {
      if (this.host.navigateToProjectFilter) {
        return this.host.navigateToProjectFilter(context);
      }
      return false;
    }
    return false;
  }

  applyTo(row: TicketRow): boolean {
    return (
      (this.host.criteria.state === null ||
        row.state === this.host.criteria.state) &&
      (this.host.criteria.closed === null ||
        row.closed === this.host.criteria.closed) &&
      (this.host.criteria.parent === null ||
        row.parent === this.host.criteria.parent.identifier) &&
      (this.host.criteria.who === null ||
        row.assigneeId === this.host.criteria.who.id) &&
      (this.host.criteria.project === null ||
        row.projectId === this.host.criteria.project.id)
    );
  }
}
