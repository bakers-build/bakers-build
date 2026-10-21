import * as React from 'react';
export interface StatusPillProps {
  /** visual state -> tint + text color */
  state?: 'running' | 'attention' | 'needs_input' | 'waiting' | 'wait' | 'critical';
  /** lead with a pulsing StatusDot (use for running) */
  withDot?: boolean;
  /** optional leading SVG marker (attention/needs_input) */
  icon?: React.ReactNode;
  children?: React.ReactNode;
}
export function StatusPill(props: StatusPillProps): React.JSX.Element;
