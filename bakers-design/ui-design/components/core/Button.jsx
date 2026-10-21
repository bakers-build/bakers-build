import React from 'react';
/** Action link/button. bakers.build is read-only, so real "actions" are links to Drupal edit forms. */
export function Button({ variant = 'standard', href, icon = null, children, ...rest }) {
  const cls = `bakers-btn${variant !== 'standard' ? ' bakers-btn--' + variant : ''}`;
  const inner = <>{icon}{children}</>;
  return href
    ? <a className={cls} href={href} {...rest}>{inner}</a>
    : <button className={cls} type="button" {...rest}>{inner}</button>;
}
