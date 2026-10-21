import * as React from 'react';
export interface TagProps {
  variant?: 'default' | 'cap';
  children?: React.ReactNode;
}
export function Tag(props: TagProps): React.JSX.Element;
