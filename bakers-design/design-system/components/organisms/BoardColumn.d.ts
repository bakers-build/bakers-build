import * as React from 'react';
export interface BoardColumnProps {
  /** workflow state id, e.g. "coding" */
  name: string;
  count: number;
  /** optional header dot for live columns (coding=running, human_input=attention) */
  accent?: 'running' | 'attention';
  /** empty-state hint text */
  empty?: string;
  children?: React.ReactNode;
}
export function BoardColumn(props: BoardColumnProps): React.JSX.Element;
