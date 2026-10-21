import * as React from 'react';
export interface AvatarProps {
  /** 1-2 uppercase initials */
  initials: string;
  kind?: 'running' | 'lease';
  size?: 'sm' | 'md';
}
export function Avatar(props: AvatarProps): React.JSX.Element;
