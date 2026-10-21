import React from 'react';
/** Status dot — the atomic state signifier. Pairs with an accent edge, never used alone. */
export function StatusDot({ state = 'running', className = '' }) {
  return <span className={`bakers-dot bakers-dot--${state} ${className}`} aria-hidden="true" />;
}
