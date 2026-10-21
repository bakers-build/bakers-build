import React from 'react';
/** Neutral metadata tag. The "cap" variant marks a capability requirement (mono, Gin-primary). */
export function Tag({ variant = 'default', children }) {
  return <span className={`bakers-tag${variant === 'cap' ? ' bakers-tag--cap' : ''}`}>{children}</span>;
}
