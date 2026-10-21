import React from 'react';
import { FilterButton } from '../atoms/FilterButton.jsx';
import { Toggle } from '../atoms/Toggle.jsx';
/** Global filter bar (querystring-backed) that scopes every section. Composes FilterButton + Toggle atoms. */
export function FilterBar({ projectsLabel = 'alle', conductorsCount, mineOn = false, querystring }) {
  return (
    <div className="bakers-filters" id="filters">
      <span className="bakers-filters__lbl">Filter</span>
      <FilterButton caption="Projekte" value={projectsLabel} />
      <FilterButton caption="Conductors" count={conductorsCount} value="alle" />
      <Toggle on={mineOn}>Meine</Toggle>
      <span style={{ flex: 1 }} />
      {querystring && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--gin-text-faint)' }}>{querystring}</span>}
    </div>
  );
}
