import * as React from 'react';
export interface FilterButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** muted caption prefix, e.g. "Projekte" */
  caption: string;
  /** current value shown when no count badge is used */
  value?: string;
  /** selected-item count — renders a primary badge instead of the value and highlights the button */
  count?: number;
  /** force the active (primary-border) treatment */
  active?: boolean;
}
export function FilterButton(props: FilterButtonProps): React.JSX.Element;
