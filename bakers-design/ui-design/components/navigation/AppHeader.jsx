import React from 'react';
const MARK = (
  <svg width="24" height="27" viewBox="0 0 64 74" fill="none" style={{ overflow: 'visible' }} aria-label="bakers.build">
    <line x1="32" y1="7" x2="32" y2="16" stroke="currentColor" strokeWidth="1.4" opacity=".5"/>
    <line x1="17" y1="16" x2="47" y2="16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
    <line x1="17" y1="16" x2="17" y2="24" stroke="currentColor" strokeWidth="1.4" opacity=".5"/><circle cx="17" cy="30" r="6.2" fill="#4BB9AE"/>
    <line x1="47" y1="16" x2="47" y2="24" stroke="currentColor" strokeWidth="1.4" opacity=".5"/>
    <line x1="40" y1="24" x2="54" y2="24" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
    <line x1="40" y1="24" x2="40" y2="31" stroke="currentColor" strokeWidth="1.4" opacity=".5"/><path d="M40 30 l5.4 9 h-10.8 Z" fill="#8197F8"/>
    <line x1="54" y1="24" x2="54" y2="30" stroke="currentColor" strokeWidth="1.4" opacity=".5"/><rect x="49.4" y="30" width="9.2" height="9.2" rx="2.4" fill="#FFC024"/>
  </svg>
);
const ICONS = {
  dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>,
  board: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="5" height="14" rx="1"/></svg>,
  nodes: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>,
  billing: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>,
};
const DEFAULT_NAV = [
  { key: 'dashboard', label: 'Dashboard', href: 'bakers.build Dashboard.html' },
  { key: 'board', label: 'Board', href: 'bakers.build Dashboard.html#frag-board' },
  { key: 'nodes', label: 'Nodes', href: 'bakers.build Dashboard.html#frag-nodes' },
  { key: 'billing', label: 'Abrechnung', href: 'bakers.build Dashboard.html#frag-billing' },
];
/** Product header: brand + horizontal nav + auto-refresh ring + user. Replaces Gin's backend rail. */
export function AppHeader({ active = 'dashboard', badge, user = 'mk', items = DEFAULT_NAV, refresh = true }) {
  return (
    <header className="bakers-appbar">
      <div className="bakers-brand">
        <span className="bakers-brand__mark">{MARK}</span>
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.02 }}>
          <span className="bakers-brand__name">bakers.build</span>
          <span className="bakers-brand__sub">Orchestrierung</span>
        </span>
      </div>
      <nav className="bakers-nav" aria-label="Hauptnavigation">
        {items.map((it) => (
          <a key={it.key} href={it.href} className={it.key === active ? 'is-active' : undefined}>
            {ICONS[it.key]}{it.label}
            {it.key === 'dashboard' && badge != null && <span className="bakers-nav__badge">{badge}</span>}
          </a>
        ))}
      </nav>
      <span style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {refresh && (
          <span className="bakers-refresh">
            <svg className="bakers-ring" viewBox="0 0 20 20" fill="none" strokeWidth="2.5">
              <circle className="bakers-ring__bg" cx="10" cy="10" r="8" />
              <circle className="bakers-ring__fg" cx="10" cy="10" r="8" />
            </svg>
            auto <b style={{ color: 'var(--gin-text)', fontWeight: 600 }}>15 s</b>
          </span>
        )}
        <span className="bakers-user">
          <span className="bakers-ava" style={{ width: 24, height: 24 }}>{user.slice(0, 2).toUpperCase()}</span>
          <span style={{ fontWeight: 600 }}>{user}</span>
          <svg style={{ width: 13, height: 13, color: 'var(--gin-text-light)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </div>
    </header>
  );
}
