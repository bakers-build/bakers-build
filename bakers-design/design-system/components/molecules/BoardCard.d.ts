import * as React from 'react';
export interface BoardCardLease { machine: string; mine?: boolean; }
export interface BoardCardProps {
  id: string;
  title: string;
  /** state drives the left accent edge; omit for calm cards (backlog/todo/done) */
  state?: 'running' | 'attention' | 'needs_input' | 'wait';
  prio?: 'p1' | 'p2';
  lease?: BoardCardLease;
  /** e.g. a StatusDot, pause marker, or Avatar */
  footerRight?: React.ReactNode;
}
export function BoardCard(props: BoardCardProps): React.JSX.Element;
