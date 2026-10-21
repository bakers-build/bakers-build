import React from 'react';
/** Priority chip. Only rendered for P1/P2 (no chip = default priority). */
export function PrioTag({ level }) {
  return <span className={`bakers-prio bakers-prio--${level}`}>{level.toUpperCase()}</span>;
}
