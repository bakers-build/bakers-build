import * as React from 'react';
export interface ButtonProps {
  /** primary (Gin accent) · standard · xs (compact) · cta (swimsuit — critical assign only) */
  variant?: 'primary' | 'standard' | 'xs' | 'cta';
  /** render as <a> to a Drupal entity edit form */
  href?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): React.JSX.Element;
