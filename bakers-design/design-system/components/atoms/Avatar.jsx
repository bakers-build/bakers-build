import React from 'react';
/** Initials avatar. Teal by default; ocean for conductor-owner context. */
export function Avatar({ initials, kind = 'running', size = 'md' }) {
  return <span className={`bakers-ava${kind === 'lease' ? ' bakers-ava--lease' : ''}${size === 'sm' ? ' bakers-ava--sm' : ''}`}>{initials}</span>;
}
