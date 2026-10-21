import * as React from 'react';
export interface TicketRowAssignee { initials: string; name: string; }
export interface TicketRowLease { machine: string; mine?: boolean; }
export interface TicketRowProps {
  id: string;
  title: string;
  project: string;
  /** workflow state label, e.g. "coding" */
  stateLabel: string;
  /** urgency class driving the left accent edge + row tint */
  state: 'wait' | 'needs_input' | 'attention' | 'running' | 'idle';
  /** the rendered StatusPill for this row */
  statusNode: React.ReactNode;
  lease?: TicketRowLease;
  since: string;
  /** null => unassigned (shows NIEMAND + CTA) */
  assignee?: TicketRowAssignee | null;
  href?: string;
}
export function TicketRow(props: TicketRowProps): React.JSX.Element;
