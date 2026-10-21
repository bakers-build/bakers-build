import * as React from 'react';
export interface PrioTagProps {
  /** p1 (critical, swimsuit) · p2 (neutral) */
  level: 'p1' | 'p2';
}
export function PrioTag(props: PrioTagProps): React.JSX.Element;
