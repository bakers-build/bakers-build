import React from 'react';
import { PrioTag } from '../atoms/PrioTag.jsx';
import { LeaseBadge } from '../atoms/LeaseBadge.jsx';
import { StatusDot } from '../atoms/StatusDot.jsx';
/** Kanban ticket card. Left accent edge = state; footer carries lease + a dot/marker. */
export function BoardCard({ id, title, state, prio, lease, footerRight }) {
  const mod = state ? ` bakers-tk--${state}` : '';
  return (
    <article className={`bakers-tk${mod}`}>
      <div className="bakers-tk__top">
        <span className="bakers-tk__id">{id}</span>
        <span className="bakers-tk__sp" />
        {prio && <PrioTag level={prio} />}
      </div>
      <p className="bakers-tk__title">{title}</p>
      {(lease || footerRight) && (
        <div className="bakers-tk__foot">
          {lease && <LeaseBadge machine={lease.machine} mine={lease.mine} />}
          <span className="bakers-tk__sp" />
          {footerRight}
        </div>
      )}
    </article>
  );
}
export { StatusDot };
