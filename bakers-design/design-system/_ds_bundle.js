/* @ds-bundle: {"format":4,"namespace":"Bb20_f99cfa","components":[{"name":"Avatar","sourcePath":"components/atoms/Avatar.jsx"},{"name":"Button","sourcePath":"components/atoms/Button.jsx"},{"name":"FilterButton","sourcePath":"components/atoms/FilterButton.jsx"},{"name":"LeaseBadge","sourcePath":"components/atoms/LeaseBadge.jsx"},{"name":"PrioTag","sourcePath":"components/atoms/PrioTag.jsx"},{"name":"StatusDot","sourcePath":"components/atoms/StatusDot.jsx"},{"name":"Tag","sourcePath":"components/atoms/Tag.jsx"},{"name":"Toggle","sourcePath":"components/atoms/Toggle.jsx"},{"name":"BoardCard","sourcePath":"components/molecules/BoardCard.jsx"},{"name":"FilterBar","sourcePath":"components/molecules/FilterBar.jsx"},{"name":"StatusPill","sourcePath":"components/molecules/StatusPill.jsx"},{"name":"AppHeader","sourcePath":"components/organisms/AppHeader.jsx"},{"name":"BoardColumn","sourcePath":"components/organisms/BoardColumn.jsx"},{"name":"SectionShell","sourcePath":"components/organisms/SectionShell.jsx"},{"name":"TicketRow","sourcePath":"components/organisms/TicketRow.jsx"}],"sourceHashes":{"components/atoms/Avatar.jsx":"e3611b6b6bbe","components/atoms/Button.jsx":"3e09525b5a63","components/atoms/FilterButton.jsx":"a45af3c21e1e","components/atoms/LeaseBadge.jsx":"bd2023bd09fc","components/atoms/PrioTag.jsx":"c7e788967761","components/atoms/StatusDot.jsx":"40086007749e","components/atoms/Tag.jsx":"80873be183d6","components/atoms/Toggle.jsx":"78e2e8c987c3","components/molecules/BoardCard.jsx":"0c070c3c6218","components/molecules/FilterBar.jsx":"e288ce5469e3","components/molecules/StatusPill.jsx":"80a634b1c161","components/organisms/AppHeader.jsx":"87b70abbb134","components/organisms/BoardColumn.jsx":"49c9c5d37dff","components/organisms/SectionShell.jsx":"7aa379e7fe01","components/organisms/TicketRow.jsx":"a6fde8556477"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.Bb20_f99cfa = window.Bb20_f99cfa || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/atoms/Avatar.jsx
try { (() => {
/** Initials avatar. Teal by default; ocean for conductor-owner context. */
function Avatar({
  initials,
  kind = 'running',
  size = 'md'
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `bakers-ava${kind === 'lease' ? ' bakers-ava--lease' : ''}${size === 'sm' ? ' bakers-ava--sm' : ''}`
  }, initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/atoms/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/atoms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Action link/button. bakers.build is read-only, so real "actions" are links to Drupal edit forms. */
function Button({
  variant = 'standard',
  href,
  icon = null,
  children,
  ...rest
}) {
  const cls = `bakers-btn${variant !== 'standard' ? ' bakers-btn--' + variant : ''}`;
  const inner = /*#__PURE__*/React.createElement(React.Fragment, null, icon, children);
  return href ? /*#__PURE__*/React.createElement("a", _extends({
    className: cls,
    href: href
  }, rest), inner) : /*#__PURE__*/React.createElement("button", _extends({
    className: cls,
    type: "button"
  }, rest), inner);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/atoms/Button.jsx", error: String((e && e.message) || e) }); }

// components/atoms/FilterButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const chev = /*#__PURE__*/React.createElement("svg", {
  style: {
    width: 13,
    height: 13,
    color: 'var(--gin-text-light)'
  },
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.4"
}, /*#__PURE__*/React.createElement("path", {
  d: "M6 9l6 6 6-6"
}));
/** Caption + value dropdown trigger. Shows a count badge (and highlights) when `count` > 0. */
function FilterButton({
  caption,
  value = 'alle',
  count,
  active = false,
  ...rest
}) {
  const isActive = active || count != null && count > 0;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: `bakers-fbtn${isActive ? ' is-active' : ''}`
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "cap"
  }, caption), count != null ? /*#__PURE__*/React.createElement("span", {
    className: "bakers-fbtn__cnt"
  }, count) : value, chev);
}
Object.assign(__ds_scope, { FilterButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/atoms/FilterButton.jsx", error: String((e && e.message) || e) }); }

// components/atoms/LeaseBadge.jsx
try { (() => {
/** Claim-lease ownership badge: a lock + the machine_id. Outlined when it's the current user's. */
function LeaseBadge({
  machine,
  mine = false
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `bakers-lease${mine ? ' bakers-lease--mine' : ''}`
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "5",
    y: "11",
    width: "14",
    height: "9",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 11V8a4 4 0 0 1 8 0v3"
  })), machine);
}
Object.assign(__ds_scope, { LeaseBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/atoms/LeaseBadge.jsx", error: String((e && e.message) || e) }); }

// components/atoms/PrioTag.jsx
try { (() => {
/** Priority chip. Only rendered for P1/P2 (no chip = default priority). */
function PrioTag({
  level
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `bakers-prio bakers-prio--${level}`
  }, level.toUpperCase());
}
Object.assign(__ds_scope, { PrioTag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/atoms/PrioTag.jsx", error: String((e && e.message) || e) }); }

// components/atoms/StatusDot.jsx
try { (() => {
/** Status dot — the atomic state signifier. Pairs with an accent edge, never used alone. */
function StatusDot({
  state = 'running',
  className = ''
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `bakers-dot bakers-dot--${state} ${className}`,
    "aria-hidden": "true"
  });
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/atoms/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/atoms/Tag.jsx
try { (() => {
/** Neutral metadata tag. The "cap" variant marks a capability requirement (mono, Gin-primary). */
function Tag({
  variant = 'default',
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `bakers-tag${variant === 'cap' ? ' bakers-tag--cap' : ''}`
  }, children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/atoms/Tag.jsx", error: String((e && e.message) || e) }); }

// components/atoms/Toggle.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Pill switch toggle. Lease-teal when on. Presentational — the parent owns state. */
function Toggle({
  on = false,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: `bakers-toggle${on ? ' is-on' : ''}`,
    "aria-pressed": on
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "bakers-toggle__sw"
  }), children);
}
Object.assign(__ds_scope, { Toggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/atoms/Toggle.jsx", error: String((e && e.message) || e) }); }

// components/molecules/BoardCard.jsx
try { (() => {
/** Kanban ticket card. Left accent edge = state; footer carries lease + a dot/marker. */
function BoardCard({
  id,
  title,
  state,
  prio,
  lease,
  footerRight
}) {
  const mod = state ? ` bakers-tk--${state}` : '';
  return /*#__PURE__*/React.createElement("article", {
    className: `bakers-tk${mod}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "bakers-tk__top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "bakers-tk__id"
  }, id), /*#__PURE__*/React.createElement("span", {
    className: "bakers-tk__sp"
  }), prio && /*#__PURE__*/React.createElement(__ds_scope.PrioTag, {
    level: prio
  })), /*#__PURE__*/React.createElement("p", {
    className: "bakers-tk__title"
  }, title), (lease || footerRight) && /*#__PURE__*/React.createElement("div", {
    className: "bakers-tk__foot"
  }, lease && /*#__PURE__*/React.createElement(__ds_scope.LeaseBadge, {
    machine: lease.machine,
    mine: lease.mine
  }), /*#__PURE__*/React.createElement("span", {
    className: "bakers-tk__sp"
  }), footerRight));
}
Object.assign(__ds_scope, { BoardCard, StatusDot: __ds_scope.StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/molecules/BoardCard.jsx", error: String((e && e.message) || e) }); }

// components/molecules/FilterBar.jsx
try { (() => {
/** Global filter bar (querystring-backed) that scopes every section. Composes FilterButton + Toggle atoms. */
function FilterBar({
  projectsLabel = 'alle',
  conductorsCount,
  mineOn = false,
  querystring
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "bakers-filters",
    id: "filters"
  }, /*#__PURE__*/React.createElement("span", {
    className: "bakers-filters__lbl"
  }, "Filter"), /*#__PURE__*/React.createElement(__ds_scope.FilterButton, {
    caption: "Projekte",
    value: projectsLabel
  }), /*#__PURE__*/React.createElement(__ds_scope.FilterButton, {
    caption: "Conductors",
    count: conductorsCount,
    value: "alle"
  }), /*#__PURE__*/React.createElement(__ds_scope.Toggle, {
    on: mineOn
  }, "Meine"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), querystring && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--gin-text-faint)'
    }
  }, querystring));
}
Object.assign(__ds_scope, { FilterBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/molecules/FilterBar.jsx", error: String((e && e.message) || e) }); }

// components/molecules/StatusPill.jsx
try { (() => {
/** Labeled state pill. Optionally leads with a pulsing dot (running) or an SVG marker. */
function StatusPill({
  state = 'running',
  children,
  withDot = false,
  icon = null
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `bakers-pill bakers-pill--${state}`
  }, withDot ? /*#__PURE__*/React.createElement(__ds_scope.StatusDot, {
    state: state
  }) : icon, children);
}
Object.assign(__ds_scope, { StatusPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/molecules/StatusPill.jsx", error: String((e && e.message) || e) }); }

// components/organisms/AppHeader.jsx
try { (() => {
const MARK = /*#__PURE__*/React.createElement("svg", {
  width: "24",
  height: "27",
  viewBox: "0 0 64 74",
  fill: "none",
  style: {
    overflow: 'visible'
  },
  "aria-label": "bakers.build"
}, /*#__PURE__*/React.createElement("line", {
  x1: "32",
  y1: "7",
  x2: "32",
  y2: "16",
  stroke: "currentColor",
  strokeWidth: "1.4",
  opacity: ".5"
}), /*#__PURE__*/React.createElement("line", {
  x1: "17",
  y1: "16",
  x2: "47",
  y2: "16",
  stroke: "currentColor",
  strokeWidth: "2.4",
  strokeLinecap: "round"
}), /*#__PURE__*/React.createElement("line", {
  x1: "17",
  y1: "16",
  x2: "17",
  y2: "24",
  stroke: "currentColor",
  strokeWidth: "1.4",
  opacity: ".5"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "17",
  cy: "30",
  r: "6.2",
  fill: "#4BB9AE"
}), /*#__PURE__*/React.createElement("line", {
  x1: "47",
  y1: "16",
  x2: "47",
  y2: "24",
  stroke: "currentColor",
  strokeWidth: "1.4",
  opacity: ".5"
}), /*#__PURE__*/React.createElement("line", {
  x1: "40",
  y1: "24",
  x2: "54",
  y2: "24",
  stroke: "currentColor",
  strokeWidth: "2.4",
  strokeLinecap: "round"
}), /*#__PURE__*/React.createElement("line", {
  x1: "40",
  y1: "24",
  x2: "40",
  y2: "31",
  stroke: "currentColor",
  strokeWidth: "1.4",
  opacity: ".5"
}), /*#__PURE__*/React.createElement("path", {
  d: "M40 30 l5.4 9 h-10.8 Z",
  fill: "#8197F8"
}), /*#__PURE__*/React.createElement("line", {
  x1: "54",
  y1: "24",
  x2: "54",
  y2: "30",
  stroke: "currentColor",
  strokeWidth: "1.4",
  opacity: ".5"
}), /*#__PURE__*/React.createElement("rect", {
  x: "49.4",
  y: "30",
  width: "9.2",
  height: "9.2",
  rx: "2.4",
  fill: "#FFC024"
}));
const ICONS = {
  dashboard: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "7",
    height: "9",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "3",
    width: "7",
    height: "5",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "12",
    width: "7",
    height: "9",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "16",
    width: "7",
    height: "5",
    rx: "1"
  })),
  board: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "5",
    height: "16",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "10",
    y: "4",
    width: "5",
    height: "11",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "17",
    y: "4",
    width: "5",
    height: "14",
    rx: "1"
  })),
  nodes: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "18",
    height: "7",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "13",
    width: "18",
    height: "7",
    rx: "1.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 7.5h.01M7 16.5h.01"
  })),
  billing: /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("ellipse", {
    cx: "12",
    cy: "6",
    rx: "8",
    ry: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"
  }))
};
const DEFAULT_NAV = [{
  key: 'dashboard',
  label: 'Dashboard',
  href: 'bakers.build Dashboard.html'
}, {
  key: 'board',
  label: 'Board',
  href: 'bakers.build Dashboard.html#frag-board'
}, {
  key: 'nodes',
  label: 'Nodes',
  href: 'bakers.build Dashboard.html#frag-nodes'
}, {
  key: 'billing',
  label: 'Abrechnung',
  href: 'bakers.build Dashboard.html#frag-billing'
}];
/** Product header: brand + horizontal nav + auto-refresh ring + user. Replaces Gin's backend rail. */
function AppHeader({
  active = 'dashboard',
  badge,
  user = 'mk',
  items = DEFAULT_NAV,
  refresh = true
}) {
  return /*#__PURE__*/React.createElement("header", {
    className: "bakers-appbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bakers-brand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "bakers-brand__mark"
  }, MARK), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      lineHeight: 1.02
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "bakers-brand__name"
  }, "bakers.build"), /*#__PURE__*/React.createElement("span", {
    className: "bakers-brand__sub"
  }, "Orchestrierung"))), /*#__PURE__*/React.createElement("nav", {
    className: "bakers-nav",
    "aria-label": "Hauptnavigation"
  }, items.map(it => /*#__PURE__*/React.createElement("a", {
    key: it.key,
    href: it.href,
    className: it.key === active ? 'is-active' : undefined
  }, ICONS[it.key], it.label, it.key === 'dashboard' && badge != null && /*#__PURE__*/React.createElement("span", {
    className: "bakers-nav__badge"
  }, badge)))), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, refresh && /*#__PURE__*/React.createElement("span", {
    className: "bakers-refresh"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "bakers-ring",
    viewBox: "0 0 20 20",
    fill: "none",
    strokeWidth: "2.5"
  }, /*#__PURE__*/React.createElement("circle", {
    className: "bakers-ring__bg",
    cx: "10",
    cy: "10",
    r: "8"
  }), /*#__PURE__*/React.createElement("circle", {
    className: "bakers-ring__fg",
    cx: "10",
    cy: "10",
    r: "8"
  })), "auto ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--gin-text)',
      fontWeight: 600
    }
  }, "15 s")), /*#__PURE__*/React.createElement("span", {
    className: "bakers-user"
  }, /*#__PURE__*/React.createElement("span", {
    className: "bakers-ava",
    style: {
      width: 24,
      height: 24
    }
  }, user.slice(0, 2).toUpperCase()), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, user), /*#__PURE__*/React.createElement("svg", {
    style: {
      width: 13,
      height: 13,
      color: 'var(--gin-text-light)'
    },
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.4"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 9l6 6 6-6"
  })))));
}
Object.assign(__ds_scope, { AppHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/organisms/AppHeader.jsx", error: String((e && e.message) || e) }); }

// components/organisms/BoardColumn.jsx
try { (() => {
/** A workflow-state column. Header carries an optional accent dot + count; empty state is a hint. */
function BoardColumn({
  name,
  count,
  accent,
  empty,
  children
}) {
  const hasChildren = React.Children.count(children) > 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "bakers-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bakers-col__hd"
  }, accent && /*#__PURE__*/React.createElement(__ds_scope.StatusDot, {
    state: accent
  }), /*#__PURE__*/React.createElement("span", {
    className: "bakers-col__nm"
  }, name), /*#__PURE__*/React.createElement("span", {
    className: "bakers-col__ct"
  }, count)), hasChildren ? /*#__PURE__*/React.createElement("div", {
    className: "bakers-col__body"
  }, children) : /*#__PURE__*/React.createElement("div", {
    className: "bakers-col__empty"
  }, /*#__PURE__*/React.createElement("span", null, empty || 'leer')));
}
Object.assign(__ds_scope, { BoardColumn });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/organisms/BoardColumn.jsx", error: String((e && e.message) || e) }); }

// components/organisms/SectionShell.jsx
try { (() => {
/** One dashboard section = one htmx fragment. Header (title + count + updated) over a body. */
function SectionShell({
  title,
  count,
  countAlert = false,
  updated,
  id,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "bakers-sec",
    id: id,
    "data-screen-label": id
  }, /*#__PURE__*/React.createElement("div", {
    className: "bakers-sec__hd"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "bakers-sec__title"
  }, title), count != null && /*#__PURE__*/React.createElement("span", {
    className: `bakers-sec__count${countAlert ? ' bakers-sec__count--alert' : ''}`
  }, count), /*#__PURE__*/React.createElement("span", {
    className: "bakers-sec__spacer"
  }), updated && /*#__PURE__*/React.createElement("span", {
    className: "bakers-sec__upd"
  }, updated)), /*#__PURE__*/React.createElement("div", {
    className: "bakers-sec__body"
  }, children));
}
Object.assign(__ds_scope, { SectionShell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/organisms/SectionShell.jsx", error: String((e && e.message) || e) }); }

// components/organisms/TicketRow.jsx
try { (() => {
/** One row of the board-independent "Aktive Tickets" table. Left edge + status pill encode state. */
function TicketRow({
  id,
  title,
  project,
  stateLabel,
  state,
  statusNode,
  lease,
  since,
  assignee,
  href
}) {
  return /*#__PURE__*/React.createElement("tr", {
    className: `bakers-row--${state}`
  }, /*#__PURE__*/React.createElement("td", {
    className: "bakers-row__lead"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontWeight: 600
    }
  }, id)), /*#__PURE__*/React.createElement("td", {
    style: {
      color: 'var(--gin-text)',
      maxWidth: 300,
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      color: 'var(--gin-text-light)'
    }
  }, project)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11.5px',
      color: 'var(--gin-text-light)'
    }
  }, stateLabel)), /*#__PURE__*/React.createElement("td", null, lease ? /*#__PURE__*/React.createElement(__ds_scope.LeaseBadge, {
    machine: lease.machine,
    mine: lease.mine
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--gin-text-faint)',
      fontFamily: 'var(--font-mono)'
    }
  }, "—")), /*#__PURE__*/React.createElement("td", null, statusNode), /*#__PURE__*/React.createElement("td", {
    className: "num",
    style: {
      color: 'var(--gin-text-faint)',
      fontFamily: 'var(--font-mono)'
    }
  }, since), /*#__PURE__*/React.createElement("td", null, assignee ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      color: 'var(--gin-text-light)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    initials: assignee.initials,
    size: "sm"
  }), assignee.name) : /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      color: 'var(--bakers-unassigned-ink)',
      fontWeight: 700
    }
  }, "NIEMAND")), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, assignee ? /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "xs",
    href: href
  }, "Ticket") : /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "cta",
    href: href
  }, "Zuweisen")));
}
Object.assign(__ds_scope, { TicketRow, StatusPill: __ds_scope.StatusPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/organisms/TicketRow.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.FilterButton = __ds_scope.FilterButton;

__ds_ns.LeaseBadge = __ds_scope.LeaseBadge;

__ds_ns.PrioTag = __ds_scope.PrioTag;

__ds_ns.StatusDot = __ds_scope.StatusDot;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Toggle = __ds_scope.Toggle;

__ds_ns.BoardCard = __ds_scope.BoardCard;

__ds_ns.FilterBar = __ds_scope.FilterBar;

__ds_ns.StatusPill = __ds_scope.StatusPill;

__ds_ns.AppHeader = __ds_scope.AppHeader;

__ds_ns.BoardColumn = __ds_scope.BoardColumn;

__ds_ns.SectionShell = __ds_scope.SectionShell;

__ds_ns.TicketRow = __ds_scope.TicketRow;

})();
