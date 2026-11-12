# `.bakers/` — connection and engine configuration

Host scripts live under `.bakers/scripts/`. After applying the script relocation, reload the
conductor configuration before using `provision_up`: a running conductor retains old command
strings. Apply and deliver protected-file changes outside the isolated run.

> **This repo commits no connection.** It once pointed every checkout at the
> develop control plane (dev2); bakers's own tickets now live on prod
> (`https://app.bakers.build`), so `bakers` uses each developer's private
> `~/.bakers/connections/default.js` (another with `--connection <id>` or
> `BAKERS_CONNECTION`). The committed `project.config.js` carries
> no identity: bakers derives the conductor id from this machine's `machine_id` (a UUID for a new machine; an existing id stays; written by
> `bakers init` to `~/.bakers/machine.config.js`), the project and the variant. The notes below
> still apply to any project-level `.bakers/connection.config.js` (never committed).

Reference for the bakers.build **connection**
config (BB-201): a dropsh-shaped `{ site, plugins }` read by `bakers ui`,
`bakers tools`, `bakers auth`, and this conductor's auth. The engine
wiring lives in the sibling [`project.config.js`](project.config.js)
(engine-only).

## Keep the connection small — it is a hard runtime limit, not a style rule

**A connection file must stay under ~2.4 KB on disk.** This is why the prose that
used to sit in that file lives here instead. It is not tidiness; a larger file
makes `bakers ui` fail to start.

`bakers ui` re-execs itself under **Bun** (`bakers-cli/ui/src/bun-runtime.ts`), while
`bakers tools` and `bakers auth` stay on Node. Since BB-448, `importConfig`
(`bakers-cli/core/src/cli/import-config.ts`) loads a config not as a file but as a
base64 `data:` URL, with any file it imports
inlined recursively as nested `data:` URLs of their own. Bun's module resolver
treats that URL as a package specifier and refuses it past roughly 6 KiB —
measured on Bun 1.3.14: last URL that resolves 6128 bytes, first that fails 6192,
reported as `NameTooLong while resolving package 'data:text/javascript;base64,…'`.
Node has no such limit, which is why only `bakers ui` breaks.

The budget works backwards from that ceiling: base64 inflates by 4/3, and inlined
imports cost their own share of the URL, so a source file over
roughly 2.5 KB pushes the URL past the limit. An 8.9 KB connection file produced
a ~14.7 KB URL and `bakers ui` painted nothing — the real error was swallowed by an
empty `catch` in `load-bakers-config.ts` and surfaced only as *"Could not import
connection …; check its syntax"*.

So: **add explanation here, not there.** If `bakers ui` starts failing with
`Could not import connection`, check this file's size first.

## `schema_version` (BB-216)

The connection-config schema version, kept in sync with the `@bakers-schema-version`
marker in the file header; any version other than 1 fails loading.

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

Because it is a **per-install** value it lives in the private connection, never in a
committed file (`~/.bakers/connections/default.js`):

```js
export default { schema_version: 1, site: { … }, workspace_id: '<bb_workspace uuid>', … };
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
carries the rule; `.bakers/scripts/worktree-post.sh` copies the file from the parent clone into each new
worktree, so a conductor-dispatched run reads the same declaration you wrote once here.
