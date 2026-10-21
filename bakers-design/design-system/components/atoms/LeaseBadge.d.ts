import * as React from 'react';
export interface LeaseBadgeProps {
  /** conductor machine_id holding the lease, e.g. "srv01-bakers" */
  machine: string;
  /** outline when the lease belongs to the current operator */
  mine?: boolean;
}
export function LeaseBadge(props: LeaseBadgeProps): React.JSX.Element;
