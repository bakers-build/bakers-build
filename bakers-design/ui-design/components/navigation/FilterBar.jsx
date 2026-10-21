import React from 'react';
const chev = <svg style={{ width: 13, height: 13, color: 'var(--gin-text-light)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>;
/** Global filter bar (querystring-backed) that scopes every section. Presentational — the app owns state. */
export function FilterBar({ projectsLabel = 'alle', conductorsCount, mineOn = false, querystring }) {
  return (
    <div className="bakers-filters" id="filters">
      <span className="bakers-filters__lbl">Filter</span>
      <button type="button" className="bakers-fbtn"><span className="cap">Projekte</span> {projectsLabel} {chev}</button>
      <button type="button" className={`bakers-fbtn${conductorsCount ? ' is-active' : ''}`}>
        <span className="cap">Conductors</span>
        {conductorsCount ? <span className="bakers-fbtn__cnt">{conductorsCount}</span> : 'alle'} {chev}
      </button>
      <button type="button" className={`bakers-toggle${mineOn ? ' is-on' : ''}`}><span className="bakers-toggle__sw" />Meine</button>
      <span style={{ flex: 1 }} />
      {querystring && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gin-text-faint)' }}>{querystring}</span>}
    </div>
  );
}
