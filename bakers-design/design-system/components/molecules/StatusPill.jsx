import React from 'react';
import { StatusDot } from '../atoms/StatusDot.jsx';
/** Labeled state pill. Optionally leads with a pulsing dot (running) or an SVG marker. */
export function StatusPill({ state = 'running', children, withDot = false, icon = null }) {
  return (
    <span className={`bakers-pill bakers-pill--${state}`}>
      {withDot ? <StatusDot state={state} /> : icon}
      {children}
    </span>
  );
}
