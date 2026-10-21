import * as React from 'react';
export interface NavItem { key: 'dashboard' | 'board' | 'nodes' | 'billing'; label: string; href: string; }
export interface AppHeaderProps {
  active?: 'dashboard' | 'board' | 'nodes' | 'billing';
  /** red count badge on Dashboard (tickets awaiting input) */
  badge?: number;
  /** current operator username */
  user?: string;
  items?: NavItem[];
  /** show the 15s auto-refresh ring */
  refresh?: boolean;
}
export function AppHeader(props: AppHeaderProps): React.JSX.Element;
