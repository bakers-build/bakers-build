import React from 'react';
/** Claim-lease ownership badge: a lock + the machine_id. Outlined when it's the current user's. */
export function LeaseBadge({ machine, mine = false }) {
  return (
    <span className={`bakers-lease${mine ? ' bakers-lease--mine' : ''}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
      {machine}
    </span>
  );
}
