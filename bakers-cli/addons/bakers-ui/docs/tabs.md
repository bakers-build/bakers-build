# Adding a screen as a tab

Built-in screens and addon screens use the same route registry. A tab is a
route with `tab` metadata; it is not a panel or table hosted by another screen.
The kernel obtains the active tab, visible bar, keyboard cycle and click targets
from that registry. Screens do not implement `topTab()`.

## Register a screen

Expose a lazy UI entry module through the addon's `uiEntries` preset hook
and enable the addon in the workspace's `addons` list. In that entry, register a
normal screen class using the public UI API:

```ts
import {
  AsyncScreen,
  columnNode,
  textNode,
  register,
  type RouteMetadata,
} from '@bakers-build/addon-bakers-ui/ui';

class ReportsScreen extends AsyncScreen<string> {
  static readonly route: RouteMetadata = {
    id: 'project.reports',
    path: '/projects/:projectId/reports',
    parent: 'project.overview',
    tab: {
      id: 'reports',
      label: 'Reports',
      scope: 'project',
      weight: 25,
    },
  };
  readonly id = ReportsScreen.route.id;

  protected load() {
    return Promise.resolve('Project reports');
  }
  protected renderLoading() {
    return ['Loading reports…'];
  }
  protected renderReady(value: string) {
    return columnNode('reports-content', textNode({ id: 'reports-summary', content: value }));
  }
  protected chrome() {
    return { title: 'Reports' };
  }
}

register('example/reports', api => api.add(ReportsScreen));
```

The screen owns its data, cursor, actions and input handling. `AsyncScreen`,
`ListCursor`, `ListTable` and other public rendering helpers remain reusable;
there is no addon-specific wrapper contract. A screen instance survives tab
switches within its terminal session. Shared data can use `ScreenContext.store`,
the session's memory-only store. See the ticket helpers exported by the UI API
for reading, watching and updating ticket documents.

The discovery preset adds the public UI entry specifier without importing the
screen itself, so non-UI commands never load terminal dependencies:

```ts
import type { BbPreset } from '@bakers-build/core';

export const uiEntries: BbPreset['uiEntries'] = entries => [
  ...entries,
  '@example/addon-reports/ui',
];
```

Expose that preset and UI module as `./preset` and `./ui` package exports.

## Scope and placement

The existing scopes are `root`, `project`, `ticket`, `workspace-member` and
`conductor`. Tab navigation preserves route parameters in entity scopes; root
navigation clears them. The member scope retains both the selected user and
their workspace. Tab changes do not add
browser-style back-history entries.

| Metadata | Meaning |
| --- | --- |
| `id` | Unique tab id within its scope; different scopes may reuse it. |
| `label` | Text rendered in the tab bar. |
| `scope` | The bar to extend. |
| `weight` | Optional numeric default order, ascending. Unnumbered defaults follow numbered ones. |
| `before` | Place before this tab id in the same scope. |
| `after` | Place after this tab id in the same scope. |
| `scopes` | Additional scopes sharing the same route and tab. |

Built-in tab weights use steps of ten: ticket Overview `10`, Comments `20`,
Related `30`, Runs `40` and Artifacts `50`. An addon with `weight: 25` appears
between Comments and Related.

There is no built-in **Addons** tab (contract 1 is retired). Instead, Overview
grows a second card under Details/Related whenever the ticket's
conductor runs a message-capable addon: `↓`/`j` (or `↑`/`k` back) selects it
from Overview's own list, `Enter` opens the send/poll screen for that addon,
where `←`/`→` switch addon, `Enter` sends a message or opens its input form,
and `l` copies a link. A ticket whose conductor runs no addon with messages
adds no such card. Equal weights retain registration order; omitted weights
append after numbered defaults.

Use `before` to insert before the first default tab, `after` to insert after the
last, or an anchor between them. Both constraints can be supplied when needed.
An anchor can be another addon tab, regardless of import order. Referencing an
optional addon requires that addon to be enabled; unknown anchors are errors.
Prefer built-in anchors when addons should work independently.

Default tabs retain their numeric weight and registration order breaks ties.
Relative constraints take precedence over a tab's own `weight`: an anchored tab
inherits its anchor's position, and otherwise unconstrained peers retain
registration order. Placement describes ordering constraints, not exclusive
adjacency: multiple addons may insert after the same anchor.

The registry validates all contributions together before the terminal starts.
Duplicate route ids, duplicate tab ids in any declared scope, missing anchors,
and cycles fail with an identifying error. For example, placing a tab after
`runs` and before `overview` conflicts with the ticket defaults and is rejected.

## Special presentations

Most routes need only `tab`. The optional route-level `activeTab` handles
presentations that differ from the route's primary tab:

- Member routes belong to workspace-member; their explicit route metadata
  selects the contextual bar.
- ProjectPicker has no separate tab; `{ scope: 'root', id: 'projects' }` highlights
  the existing Projects tab.
- Compact ticket presentations return `null` to hide the bar.

The function receives route parameters, not a screen instance or loaded data.
This keeps tab navigation available while data is loading. A route with neither
`tab` nor `activeTab` has no tab bar. Multiple scopes share the same placement
metadata; their anchors must exist in each scope.

## Migrating an old contribution

Replace `UiPanel` / `UiTable` host contributions with a registered screen class.
Move their rendering and actions into that screen, compose the standard list or
section helpers as needed, and declare their route and tab metadata. Remove
`topTab()` declarations and edits to fixed tab arrays: the registry now supplies
both. Artifacts and Ports are examples of independent addon screens using this
API; each retains its own keys and refresh lifecycle.

## Pipe output

A route can declare `pipe: 'scope'` to print every registered screen in its active
scope, in the same resolved order as the terminal tab bar. Ticket Overview uses
this declaration: `bakers ui <ticket> | cat` prints one ticket title followed by
Overview, Comments, Related, Runs and enabled addon reports. Relative anchors,
when supplied, affect both terminal and pipe ordering consistently.

Each screen supplies only its own report via `renderNonInteractive()`. The kernel
loads, serializes and leaves screens in turn, preserving route parameters and the
session store. Screens without a report method fall back to their rendered body.
A failed contribution produces an identifying message without suppressing later
reports. Active screen subscriptions and timers are released when printing ends.

This replaces the old interleaved whole-ticket section order. Links, Branch and
Environments are now part of the Overview block; Referenced tickets precede Runs
inside Related. Shared fields such as Parent appear in each screen's block.
Teaser and board-card views, and routes without `pipe: 'scope'`, print only their
own view.

## Optional demo tabs

Enable the bounded demo ticket tabs in the connection config's addons list:

```js
'@bakers-build/addon-bakers-ui/react-experiment'
```

The entry and its `/preset` keep their historical names; both load native
screens, and no React runtime is involved. This adds a **Markdown** ticket tab.
Tab and Shift+Tab keep navigating the native ticket bar. No ticket is changed.
Markdown renders the current ticket description, followed by a separately labeled
long example. Use ↑/↓, j/k or the mouse wheel to scroll the native body viewport;
the native header and tabs remain in place. It paints through the production
Markdown parser: headings, emphasis, links with visible URLs, bullets, task lists,
quotes and fenced code. Tables, syntax highlighting and clickable links are not
implemented. The tab provides a plain pipe report.

The contribution is off by default.

## Contributed screens

A contributed screen is a native screen: extend `AsyncScreen` from the public UI
entry, return the body from `renderReady(data, context)` as an OpenTUI VNode tree
with a stable, unique `id` on every node, put header metadata in
`chrome(context)` and the plain report in `renderNonInteractive(context)`. Keys go
through `handleInput(key, context)`; return `true` to consume one before native
navigation. Global Ctrl+C and q remain kernel-owned.

`ReactScreen` was removed from the UI entry. A screen that extended it migrates
by moving its React component state into fields of the screen, its
`subscribeInput` handler into `handleInput`, and its JSX into a VNode tree built
with `h()` from `@opentui/core` (or the `columnNode`/`textNode` helpers the UI
entry exports). Reset per-visit state in `enter(context)`, and request a redraw
with `context.requestDraw()` after a change. No JSX compiler setting is needed.

### Brand mark

The startup splash pairs the bakers wordmark with the original six-row line-art braid in copper, with a turquoise clasp. The persistent header uses `╳ bakers.build`. Non-interactive output skips the splash.
