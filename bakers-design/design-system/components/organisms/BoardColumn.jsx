import React from 'react';
import { StatusDot } from '../atoms/StatusDot.jsx';
/** A workflow-state column. Header carries an optional accent dot + count; empty state is a hint. */
export function BoardColumn({ name, count, accent, empty, children }) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <div className="bakers-col">
      <div className="bakers-col__hd">
        {accent && <StatusDot state={accent} />}
        <span className="bakers-col__nm">{name}</span>
        <span className="bakers-col__ct">{count}</span>
      </div>
      {hasChildren
        ? <div className="bakers-col__body">{children}</div>
        : <div className="bakers-col__empty"><span>{empty || 'leer'}</span></div>}
    </div>
  );
}
