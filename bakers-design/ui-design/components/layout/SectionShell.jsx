import React from 'react';
/** One dashboard section = one htmx fragment. Header (title + count + updated) over a body. */
export function SectionShell({ title, count, countAlert = false, updated, id, children }) {
  return (
    <section className="bakers-sec" id={id} data-screen-label={id}>
      <div className="bakers-sec__hd">
        <h2 className="bakers-sec__title">{title}</h2>
        {count != null && <span className={`bakers-sec__count${countAlert ? ' bakers-sec__count--alert' : ''}`}>{count}</span>}
        <span className="bakers-sec__spacer" />
        {updated && <span className="bakers-sec__upd">{updated}</span>}
      </div>
      <div className="bakers-sec__body">{children}</div>
    </section>
  );
}
