import * as React from 'react';
export interface StatusDotProps {
  /** running (pulses) · attention · wait · online · stale · offline */
  state?: 'running' | 'attention' | 'wait' | 'online' | 'stale' | 'offline';
  className?: string;
}
export function StatusDot(props: StatusDotProps): React.JSX.Element;
