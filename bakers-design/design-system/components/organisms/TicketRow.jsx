import React from 'react';
import { StatusPill } from '../molecules/StatusPill.jsx';
import { LeaseBadge } from '../atoms/LeaseBadge.jsx';
import { Avatar } from '../atoms/Avatar.jsx';
import { Button } from '../atoms/Button.jsx';
/** One row of the board-independent "Aktive Tickets" table. Left edge + status pill encode state. */
export function TicketRow({ id, title, project, stateLabel, state, statusNode, lease, since, assignee, href }) {
  return (
    <tr className={`bakers-row--${state}`}>
      <td className="bakers-row__lead"><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{id}</span></td>
      <td style={{ color: 'var(--gin-text)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</td>
      <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gin-text-light)' }}>{project}</span></td>
      <td><span style={{ fontSize: '11.5px', color: 'var(--gin-text-light)' }}>{stateLabel}</span></td>
      <td>{lease ? <LeaseBadge machine={lease.machine} mine={lease.mine} /> : <span style={{ color: 'var(--gin-text-faint)', fontFamily: 'var(--font-mono)' }}>—</span>}</td>
      <td>{statusNode}</td>
      <td className="num" style={{ color: 'var(--gin-text-faint)', fontFamily: 'var(--font-mono)' }}>{since}</td>
      <td>{assignee
        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gin-text-light)' }}><Avatar initials={assignee.initials} size="sm" />{assignee.name}</span>
        : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--bakers-unassigned-ink)', fontWeight: 700 }}>NIEMAND</span>}</td>
      <td style={{ textAlign: 'right' }}>{assignee
        ? <Button variant="xs" href={href}>Ticket</Button>
        : <Button variant="cta" href={href}>Zuweisen</Button>}</td>
    </tr>
  );
}
export { StatusPill };
