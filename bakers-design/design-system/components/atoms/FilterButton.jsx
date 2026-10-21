import React from 'react';
const chev = <svg style={{ width: 13, height: 13, color: 'var(--gin-text-light)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>;
/** Caption + value dropdown trigger. Shows a count badge (and highlights) when `count` > 0. */
export function FilterButton({ caption, value = 'alle', count, active = false, ...rest }) {
  const isActive = active || (count != null && count > 0);
  return (
    <button type="button" className={`bakers-fbtn${isActive ? ' is-active' : ''}`} {...rest}>
      <span className="cap">{caption}</span>
      {count != null ? <span className="bakers-fbtn__cnt">{count}</span> : value}
      {chev}
    </button>
  );
}
