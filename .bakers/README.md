# `.bakers/` — connection and engine configuration

> **This repo no longer commits `bakers.config.js`.** It pointed every checkout at the
> develop control plane (dev2); bakers's own tickets now live on prod
> (`https://app.bakers.build`), so `bakers` falls back to each developer's
> `~/.bakers/bakers.config.js`. The committed `conductor.config.js` carries
> no identity: the server keys the conductor by this machine's `machine_id` UUID (written by
> `bakers init` to `~/.bakers/machine.config.js`), the project and the variant. The notes below
> still apply to any project-level `bakers.config.js`.

Reference for `bakers.config.js`, the bakers.build **connection**
config (BB-201): a dropsh-shaped `{ site, plugins }` read by `bakers ui`,
`bakers tools`, `bakers auth`, and this conductor's auth. Connection host and credentials come
from your user-global machine context (`~/.bakers/machine.config.js`). The engine
wiring lives in the sibling [`conductor.config.js`](conductor.config.js)
(engine-only).

## Keep `bakers.config.js` small — it is a hard runtime limit, not a style rule

**`bakers.config.js` must stay under ~2.4 KB on disk.** This is why the prose that
used to sit in that file lives here instead. It is not tidiness; a larger file
makes `bakers ui` fail to start.

`bakers ui` re-execs itself under **Bun** (`bakers-cli/ui/src/bun-runtime.ts`), while
`bakers tools` and `bakers auth` stay on Node. Since BB-448, `importConfig`
(`bakers-cli/core/src/cli/import-config.ts`) loads a config not as a file but as a
base64 `data:` URL, with `machine.config.js` and `conductor.config.local.js`
inlined recursively as nested `data:` URLs of their own. Bun's module resolver
treats that URL as a package specifier and refuses it past roughly 6 KiB —
measured on Bun 1.3.14: last URL that resolves 6128 bytes, first that fails 6192,
reported as `NameTooLong while resolving package 'data:text/javascript;base64,…'`.
Node has no such limit, which is why only `bakers ui` breaks.

The budget works backwards from that ceiling: the two inlined configs already
cost about 2.1 KB of the URL, and base64 inflates by 4/3, so a source file over
roughly 2.5 KB pushes the URL past the limit. An 8.9 KB `bakers.config.js` produced
a ~14.7 KB URL and `bakers ui` painted nothing — the real error was swallowed by an
empty `catch` in `load-bakers-config.ts` and surfaced only as *"Could not import
connection …; check its syntax"*.

So: **add explanation here, not there.** If `bakers ui` starts failing with
`Could not import connection`, check this file's size first.

## `schema_version` (BB-216)

The connection-config schema version, kept in sync with the `@bakers-schema-version`
marker in the file header; any version other than 1 fails loading, naming `bakers init`.

## `workspace_id` — the ambient workspace (BB-351)

The uuid of the `bb_workspace` this checkout creates into. **Required** —
`loadBbConfig` rejects a connection config without it. It is top-level rather
than an addon option because it is a global for the whole connection:
`@bakers-build/addon-essentials` carries the filler that consumes it, so no plugin
entry names a workspace.

It fills `workspace_id` into a `bb_group` / `bb_team` CREATE payload (dropsh
0.6.0 `alterRequest`). An explicit `workspace_id` in the payload always wins, and
`bb_project` / `bb_ticket` are untouched because their anchor (`group_id` /
`project_id`) is a real choice the caller must make.

Because it is a **per-install** value it is resolved from an override rather than
committed. Set it in the machine context (`~/.bakers/machine.config.js`) or in
`.bakers/conductor.config.local.js`:

```js
export default { workspace_id: '<bb_workspace uuid>' };
```

Read the uuid with:

```bash
bakers tools tool_api__bakers_workspace_list
```

## `addons[]` — UI extensions (BB-373)

Discovered flat in the global `addons[]`, rather than nested under a `bakers-ui`
entry, because the **surface** is decided by which preset function an addon
exports (BB-215), not by its position — one package may serve `commands` and
`uiEntries` from a single entry.

## `plugins[]` — consumed by dropsh

dropsh's resolver has no sole-function auto-pick, so `@dropsh/plugin-oauth2`
entries **must** name `export: 'oauth2Plugin'`.

dropsh 0.6.1 loads every oauth2 entry — the dedupe that once dropped all but the
first is fixed — so the three profiles below coexist.

### `bakers` — browser OAuth (default)

The default `bakers` profile uses `oauth2_authcode` (browser login with PKCE),
public client `bakers-cli`, and scope `bb:session`. It sends no client secret.
Sign in and select this profile with:

```bash
bakers auth login --provider bakers
bakers auth use bakers
bakers auth status
```

The browser account determines the signed-in user. The `machine` profile uses
the local client ID and secret with `client_credentials` and `bb:session`.
Both authentication methods remain available:

```bash
bakers auth login --provider machine
bakers auth use machine
# Switch back to browser OAuth:
bakers auth use bakers
```

An explicitly selected profile overrides the configured browser default.
## `audience.local.md` — how you want to be addressed

An optional, **never committed** file that declares who the run handoffs are written for.
`@bakers-build/bb-workflow`'s boundaries reference (*Audience and register*) reads it and owns what it means for the output;
this entry only says the file exists, because an uncommitted file is otherwise undiscoverable.

Write free prose naming what you already know and do not want explained — technologies, tools, the
repository's own vocabulary — and the tone you want. Absent the file, a run addresses a developer
working on this stack and nothing more.

It is deliberately not in the tree. How a person wants to be spoken to is that person's preference,
and a committed declaration asserts it on behalf of everyone who clones the repository. `.gitignore`
carries the rule; `.ddev/worktree-post.sh` copies the file from the parent clone into each new
worktree, so a conductor-dispatched run reads the same declaration you wrote once here.
