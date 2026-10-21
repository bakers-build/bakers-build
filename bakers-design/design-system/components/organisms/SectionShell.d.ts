import * as React from 'react';
export interface SectionShellProps {
  title: string;
  /** item count badge */
  count?: number;
  /** red badge when the count needs operator attention */
  countAlert?: boolean;
  /** e.g. "aktualisiert vor 4 s" */
  updated?: string;
  /** htmx fragment id, e.g. "frag-active" */
  id?: string;
  children?: React.ReactNode;
}
export function SectionShell(props: SectionShellProps): React.JSX.Element;
