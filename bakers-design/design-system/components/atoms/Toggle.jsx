import React from 'react';
/** Pill switch toggle. Lease-teal when on. Presentational — the parent owns state. */
export function Toggle({ on = false, children, ...rest }) {
  return (
    <button type="button" className={`bakers-toggle${on ? ' is-on' : ''}`} aria-pressed={on} {...rest}>
      <span className="bakers-toggle__sw" />
      {children}
    </button>
  );
}
