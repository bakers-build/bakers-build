import * as React from 'react';
export interface ToggleProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** switched on (lease-teal) */
  on?: boolean;
  /** label to the right of the switch */
  children?: React.ReactNode;
}
export function Toggle(props: ToggleProps): React.JSX.Element;
