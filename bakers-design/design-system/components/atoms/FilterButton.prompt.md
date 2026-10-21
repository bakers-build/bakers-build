Dropdown-trigger button for the FilterBar: a muted `caption` prefix, then either the current `value` or — when `count` is set — a primary count badge, with a trailing chevron. Highlights (primary border) whenever a count is active. Presentational; the parent opens the panel and owns selection.

```jsx
<FilterButton caption="Projekte" value="alle" />
<FilterButton caption="Conductors" count={2} />
```
