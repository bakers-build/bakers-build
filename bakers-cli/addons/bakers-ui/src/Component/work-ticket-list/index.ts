import type { Cell } from '../../lib/vnode.js';

export interface WorkTicketListItem {
  id: string;
  identifier: string;
  title: string;
  assigneeId?: string | null;
}

export interface WorkTicketListRow {
  id: string;
  cells: readonly Cell[];
}

export interface WorkTicketSection {
  heading: 'Running' | 'Waiting';
  rows: WorkTicketListRow[];
}

const rows = (tickets: readonly WorkTicketListItem[]): WorkTicketListRow[] =>
  tickets.map((ticket) => ({
    id: ticket.id,
    cells: [
      { text: ticket.identifier, width: 12 },
      { text: ticket.assigneeId ? '' : 'Unassigned', width: 12 },
      { text: ticket.title, width: 0, grow: 1 },
    ],
  }));

export function workTicketSections(workload: {
  running: readonly WorkTicketListItem[];
  waiting: readonly WorkTicketListItem[];
}): WorkTicketSection[] {
  return [
    { heading: 'Running', rows: rows(workload.running) },
    { heading: 'Waiting', rows: rows(workload.waiting) },
  ];
}
