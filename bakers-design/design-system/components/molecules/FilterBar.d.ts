import * as React from 'react';
export interface FilterBarProps {
  /** Projekte button label: "alle" | single value | "N" */
  projectsLabel?: string;
  /** selected conductor count (shows a badge instead of "alle") */
  conductorsCount?: number;
  /** "Meine" toggle active */
  mineOn?: boolean;
  /** rendered querystring preview */
  querystring?: string;
}
export function FilterBar(props: FilterBarProps): React.JSX.Element;
