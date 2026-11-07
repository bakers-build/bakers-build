# bakers.build CLI (`bakers`) — the `bakers-cli/` monorepo

`bakers-cli/` is the whole bakers.build command-line product: the plugin **host** (`bakers`), the
surface-agnostic **core** kernel, the **conductor** run engine, the **ui** cockpit app, and
every **addon** under `addons/*`. The **conductor** is the bakers.build Network node: it registers a
machine, claims tickets over Drupal JSON:API, and drives agents through executor/agent addons
(Claude, herdr, …). The CLI also exposes `bakers tools …` for the server's named tools used by the
ticket workflows, `bakers auth …` for sign-in, `bakers ui …` for the cockpit, `bakers deployment …` for release helpers, and `bakers agents` for the local agent catalog.

**Vocabulary (BB-224).** An **addon** is a *package* under `addons/*` that self-declares its
contributions through a fixed `./preset` export and is what you list in an `addons: []` config
array; one addon may ship several plugins (`@bakers-build/addon-herdr` ships an executor **and** a
workspace). A **plugin** is the *single typed per-surface contribution* — `RemotePlugin` /
`ExecutorPlugin` / `WorkspacePlugin` / `AgentPlugin` (conductor surface), `BbCommandPlugin`
(command surface), `DropSHPlugin` / `connectionPlugins` (connection surface). The `*Plugin`
interface names and the `/plugins` subpath barrels keep the word "plugins"; only the *package*
prefix is `@bakers-build/addon-`.

This document covers the **standalone CLI setup** — taking a *fresh clone* to a working
`bakers`, with **no container runtime or worktree prerequisite**. If you work in a conductor
worktree, its `after_create` hook already does the equivalent build as its last step (see the repo
`WORKFLOW.md`); this README is the runtime-free path.

## Quick start

From a fresh clone:

```bash
bakers-cli/scripts/setup.sh
# or, equivalently, from the bakers-cli/ directory:
cd bakers-cli && pnpm run bootstrap
```

Then set your OAuth consumer secret and log in:

```bash
export BB_CONSUMER_SECRET=<your consumer secret>
bakers auth login
bakers auth status      # verify
```

The setup script is **idempotent** — re-run it any time (e.g. after pulling changes that
touch any `bakers-cli/` package or addon).

## Prerequisites

- **Node.js ≥ 20.19** (see `engines` in `package.json`).
- **pnpm** — the workspace package manager. If it is missing, install it with one of:

  ```bash
  corepack enable pnpm        # ships with Node >= 16.9 (recommended)
  npm install -g pnpm
  ```

  See <https://pnpm.io/installation>. `setup.sh` checks for both and prints an actionable
  message if either is missing.

## Topology — what lives where

```
bakers-cli/
├── core/       # @bakers-build/core      — the surface-AGNOSTIC kernel: host contract, split-config
│               #                      helpers, conductor registry, utils, and the generic
│               #                      preset/discovery machinery. NO plugin
│               #                      implementations, no conductor-surface interfaces, no
│               #                      config contract. Zero @bakers-build/* edges.
├── conductor/  # @bakers-build/conductor — the run engine + the `conductor` command plugin + the
│               #                      CONDUCTOR-SURFACE CONTRACT and the config contract
│               #                      (`@bakers-build/conductor/contract`)
├── ui/         # @bakers-build/ui        — the project-first `bakers ui` cockpit command app
├── host/       # @bakers-build/bakers      — the plugin HOST (`bin bakers`) + `bakers config upgrade` + the
│               #                      `./plugins` back-compat barrel; the leaf sink
├── addons/*    # @bakers-build/addon-*   — every mountable, one package per addon
├── scripts/    # setup.sh, prepare-publish.mjs, release.mjs, verify-package.mjs, assert-acyclic.mjs
└── templates/  # conductor.config.js, bakers.config.js, conductor.config.local.js, bakers.pathshim.sh
```

**Writing an addon:** peer-depend on `@bakers-build/core` and, if it contributes to the conductor
surface, on `@bakers-build/conductor` too — then import the interfaces from the **runtime-light
subpath**:

```ts
import type { ExecutorPlugin, BbExecutor } from '@bakers-build/conductor/contract';
```

`@bakers-build/conductor/contract` carries only the surface interfaces, the config contract, the
preset view and two tiny helpers — **no** engine, **no** commander, **no** dropsh runtime — so
importing it costs nothing at boot, unlike the package main. Export the addon's contributions
from `src/preset.ts` behind the package's `./preset` export; `bakers-cli/scripts/assert-acyclic.mjs`
reads those accumulator exports to decide which peer dependencies the addon owes (a
name-pattern-free ratchet), so a conductor-surface addon that forgets the
`@bakers-build/conductor` peer fails the guard.

## What `setup.sh` does

`bakers-cli/scripts/setup.sh` resolves the repo root from its own path (no git dependency)
and runs eight idempotent steps:

1. **Prereq check** — verifies `pnpm` is on `PATH` (actionable message + non-zero exit if
   not) and sanity-checks Node ≥ 20.19.
2. **Install** — `pnpm install --config.minimumReleaseAge=0` in `bakers-cli/`. The
   `minimumReleaseAge=0` mirrors the worktree `after_create` hook, dodging the workspace supply-chain
   deps-verify policy that would otherwise fail a plain install on a fresh tree.
3. **Build the packages + addons** — `bakers-cli/bin/bakers` runs the compiled host
   (`host/dist/src/host.js`), and `.bakers/conductor.config.js` resolves the workspace packages
   whose `exports` point at `dist/src`. The workspace is `core` (kernel) + `conductor` (run
   engine) + `addons/*` (mountables) + `ui` (cockpit app) + `host` (the CLI), so the script
   builds in **layered dep order**, each step emitting the `.d.ts` the next one consumes:

   1. `core` — the surface-agnostic kernel (no `@bakers-build/*` edge);
   2. `conductor` — the run engine, which **owns the conductor-surface contract**
      (`@bakers-build/conductor/contract`) every conductor-surface addon imports, so it **must
      precede** the addons (BB-224 flipped this — the addons used to build first);
   3. `addons/*` — with `workspace-git` forced first, because `addon-herdr` takes
      `loadInstructions` from it (the one permitted addon→addon edge);
   4. `ui` — imports `@bakers-build/addon-herdr`;
   5. `host` — the leaf sink; imports `@bakers-build/ui/preset` + every addon preset.

   It invokes `tsc` directly (not `pnpm run build`) to stay fresh-tree-safe.
4. **Resolution farm** — creates a repo-root `node_modules/` symlink farm so
   `.bakers/conductor.config.js` can resolve its bare imports. Node ESM resolves
   `@bakers-build/bakers`, `@bakers-build/addon-*`, `@dropsh/*` by walking **up** from `.bakers/`; the
   repo-root farm is where it lands. Each package is linked under its **real `package.json`
   name** (not a directory-derived one — `@bakers-build/ui` lives beside `addons/`, and
   `addons/bakers-ui` is `@bakers-build/addon-bakers-ui`):

   | Import                     | Symlink target                          |
   |----------------------------|-----------------------------------------|
   | `@bakers-build/core`            | `bakers-cli/core/`                        |
   | `@bakers-build/conductor`       | `bakers-cli/conductor/`                   |
   | `@bakers-build/bakers`            | `bakers-cli/host/`                        |
   | `@bakers-build/ui`              | `bakers-cli/ui/`                          |
   | `@bakers-build/addon-<name>`    | `bakers-cli/addons/<name>/`               |
   | `@dropsh/<pkg>`            | `bakers-cli/node_modules/@dropsh/<pkg>/`  |

   The farm lives under the already-gitignored `node_modules/`, so it never dirties the
   tree. This reproduces the mechanism a nested worktree relies on today.
5. **PATH shim** — installs a test-workspace-aware `bakers` to `~/.local/bin/bakers`. It
   resolves in **two tiers** (BB-390): inside a skill-test workspace — recognised by a
   `.bakers-testbuild` marker at or above the working directory — it runs the checkout that
   marker names, failing loudly if that checkout is unbuilt; **everywhere else**, a plain
   bakers checkout included, it runs the globally-installed `bakers`. See *one shim, two
   launchers* below. If a differing `bakers` already exists there it is **left untouched**
   (warn + skip, never clobber) and the WARN prints the adoption command — see *Adopting a
   new shim*. If `~/.local/bin` is not on your `PATH`, the script prints the `export` line
   to add — and if a global `bakers` sits **ahead** of `~/.local/bin` on `PATH` (shadowing
   the shim), it warns about that too (BB-84).
6. **Config scaffold** — writes `.bakers/conductor.config.local.js` from
   `bakers-cli/templates/conductor.config.local.js`. If the file already exists it is left
   untouched. Interactive shells are prompted for `oauth.client_id` (default: `bakers-agent`);
   non-interactive shells use the default. The file carries no identity: the machine's id
   and label come from `bakers init`.
   **No secret is ever written** — the scaffold reads `client_secret` from
   `process.env.BB_CONSUMER_SECRET`.
7. **herdr run-session plugins** — links the repo-local **spiceedit** herdr plugin
   (`herdr/spiceedit`) that powers the review click-to-edit overlay (see *herdr
   run-session layouts* below). Best-effort and guarded: skipped when `herdr` is not
   on `PATH` (it is the executor, not a conductor-CLI prereq), and a missing
   `spiceedit` binary only prints a note — the overlay degrades to a message at run
   time, so nothing here fails the bootstrap.
8. **Summary** — prints the next steps (export the secret, `bakers auth login`,
   verify with `bakers auth status`).

## `bakers ui` deep links (BB-223)

`bakers ui` takes an optional target, so you open the thing you are working on directly
instead of navigating dashboard → project → list → detail every time:

```bash
bakers ui BB-221                  # a ticket by identifier (case-insensitive)
bakers ui project:bakers              # a project; also ticket:<uuid> · run:<uuid>
bakers ui --here                    # this branch's ticket, else this repo's project
bakers ui BB-221 --view teaser    # a compact block instead of the tabbed detail
```

At most **one** target source (the positional, `--ticket`, `--project`, `--run`, `--here`);
two exit non-zero naming both. Full reference — the `--here` ladder, the repo rung and its
picker, identifier normalisation, the view modes: [`ui/README.md`](./ui/README.md).

## The `bakers` command — one shim, two launchers

There is a **single** `bakers` on your `PATH` — no separate `bakers-dev` (BB-84 retired it;
if a byte-identical `~/.local/bin/bakers-dev` lingers from before, delete it). That one
`bakers` is the test-workspace-aware PATH shim, backed by two thin launchers with
different jobs:

- **`~/.local/bin/bakers`** — the test-workspace-aware PATH shim (canonical source:
  `bakers-cli/templates/bakers.pathshim.sh`), installed ahead of the npm global on `PATH`.
  It resolves in **two tiers** (BB-390): (1) inside a **skill-test workspace** — a
  `.bakers-testbuild` marker file at or above the physical working directory, written by
  `scripts/setup-test-project.sh` and holding the absolute path of the checkout that
  created the workspace — it runs *that* checkout's built `bakers-cli/bin/bakers`; a marker
  naming an unbuilt checkout fails loudly with a build hint instead of falling through to
  a different `bakers`. (2) **Everywhere else** — *inside a plain bakers checkout included* —
  it runs the globally-installed `@bakers-build/bakers`. So a bare `bakers <cmd>` is the released
  CLI unless you stand in the one place a branch build is under test, across
  bash/fish/the Claude Code `!` runner.

  The walk is over the **filesystem**, not over git: the conductor's per-ticket worktrees
  live *inside* the workspace (`<workspace>/.bakers-worktrees/<branch>`, because its
  `checkoutRoot` is its config's directory), where a git-based lookup would stop at the
  worktree's own toplevel and never see the marker.
- **`bakers-cli/bin/bakers`** — the dev launcher. It runs the built plugin **host**
  (`import('../host/dist/src/host.js')`), which lazily mounts the invoked command plugin
  (`conductor`/`ui`/`dropsh`/`deployment`/`agents`), so it needs the packages built (step 3). The
  shim execs it inside a test workspace; **to exercise a checkout's own build anywhere
  else, call `./bakers-cli/bin/bakers` by explicit path.** That is deliberate: keying tier 1
  on the git toplevel meant an unbuilt or broken branch build broke every unrelated `bakers`
  command in that worktree, and made the build reachable exactly where it was not needed
  and absent where it was.

> **Adopting a new shim.** Step 5 never overwrites a differing `~/.local/bin/bakers` — it is
> a machine-global executable you may have edited — so a changed template does **not** reach
> an existing install by re-running `setup.sh`. Adopt it explicitly (the WARN prints this
> line for you):
>
> ```bash
> cp bakers-cli/templates/bakers.pathshim.sh ~/.local/bin/bakers && chmod 0755 ~/.local/bin/bakers
> ```
>
> Diff first if you have edited yours: `diff ~/.local/bin/bakers bakers-cli/templates/bakers.pathshim.sh`.

**PATH-order hazard.** The shim only wins if `~/.local/bin` precedes the active node's
bin dir (where `npm -g @bakers-build/bakers` lands) on `PATH`. If the nvm/global bin comes first,
the released global **shadows** the shim and a bare `bakers` in a test workspace never sees
the build under test.
`setup.sh` (step 5) detects and warns about this ordering; fix it with
`export PATH="$HOME/.local/bin:$PATH"`.

## Configuration setup and upgrades

Coming from the old CLI? Follow [Switch to the bakers CLI](../docs/configuration/clients/switch-to-bakers.md).

Initialize the scopes you need:

```bash
bakers config init --scope machine
bakers config init --scope connection
bakers config init --scope project --project demo
bakers config init --scope project --project demo --workspace Engineering # when names collide
```

## Two ways to sign in

`bakers config init --scope connection` writes an `oauth2_device_code` connection by default — no
interview question, no personal secret. `--auth-type client_credentials` is the internal/CI path.

- **Device code (the default, and the only one `bakers config init` interviews for).** Writes an
  OAuth descriptor with `type: 'oauth2_device_code'`, the shared public `client_id` `bakers-cli`, a
  `device_authorization_url`, and **no `client_secret` at all** — a public client secured by a
  human confirming a short code, so there is no personal secret to obtain, store or rotate, and no
  local callback listener a browser needs to reach. Sign in with:

  ```bash
  bakers auth login
  bakers auth status
  ```

  The CLI prints a URL and a short code; open the URL on any device, confirm the code, and the CLI
  polls until the sign-in completes. This is what makes the flow work over SSH, in a container, or
  wherever the CLI's own machine has no browser at all.
- **Client secret (internal/CI only).** `bakers config init --scope connection --auth-type client_credentials`
  — never offered by the interview, always explicit. Use this for a conductor on a server or for
  CI. It asks for the personal `bakers-<kuerzel>` consumer's `client_id` and `client_secret`; the
  secret is written to the private global connection, or supplied per run through
  `--secret-env <NAME>`.

Machine context owns host identity/capacity. The private global connection owns site,
OAuth credentials and is the implicit `default` connection. The committed
`.bakers/conductor.config.js` owns committed `bakers: { project, workspace? }`; its separate top-level
`workspace` key remains the worktree plugin slot. An omitted `bakers.workspace` succeeds only when
one accessible project has that name; duplicates fail with workspace-qualified candidates and ask
you to commit the workspace name. Connection setup works without a machine file, while
project setup checks both prerequisites. Connection/project initialization reports ready
only after online authentication and workspace verification.

Create and use a second connection by id:

```bash
bakers config init --scope connection --connection staging
bakers tools --connection staging tool_api__bakers_project_list
BB_CONNECTION=staging bakers info
bakers config check --scope connection --connection staging --format json
```

To make that choice local to one checkout, add the gitignored file
`.bakers/connection.config.local.js`:

```js
export default { connection: 'staging' };
```

The final command reports the selected id, selector and provenance for each effective field;
omitted loader values such as `site.jsonapi_prefix` are identified as built-in defaults.
Computed effective values are reported with `dynamic/not statically determined` provenance.
An explicit `--config <path>` wins over named selection. Otherwise `--connection` wins over
`BB_CONNECTION`, which wins over the checkout file. An unselected checkout uses
`~/.bakers/bakers.config.js` when present; if it is absent, a sole named connection is selected
automatically. Multiple named connection files require `--connection`,
`BB_CONNECTION`, or the checkout-local selector file; bakers.build does not add another selection leg.
Existing `.bakers/bakers.config.js` project overrides still load, but
`bakers config check` reports them as superseded and `bakers config upgrade` leaves them untouched.

Update code and migrate configuration separately:

```bash
bakers update
bakers config upgrade --scope all --dry-run
bakers config upgrade --scope all
bakers config check --scope all --online
```

Upgrade plans all selected layers without importing configuration and preserves supported
values; a repeated successful upgrade changes nothing. Missing inputs and conflicts have
file/key repairs. Project upgrade migrates legacy top-level `project` and `bb_workspace`
into the nested `bakers` object in every conductor variant. Runtime loading of the legacy shape
directs you to `bakers config upgrade --scope project`. `--format json` produces one
non-interactive report. Offline checks and
upgrades do not establish online readiness. Full ownership, scope options, supported
history and the exact focused regression/CI gates are in [`CONFIG.md`](CONFIG.md).

Interactive `bakers oven start` (stdin and stdout are TTYs, `CI` is unset or empty, and
`--foreground` is absent) offers to install a newer release and migrate configuration.
Enter accepts; `n` continues and suppresses another prompt until the cached check expires.
After an accepted update, rerun the start command. `bakers ui`, foreground, CI and non-TTY
starts show only the notice. `--no-update-check` disables the lookup and notice; the
installed-version line remains visible. The result is cached at `~/.bakers/update-check.json`
(or `$BB_HOME/update-check.json`).

## Understanding claim capacity

The conductor's `machineLoad` is **reported load**: the sum of online conductors'
heartbeats. Admission uses a separate, authoritative count of runs belonging to
all conductors linked to the machine. It counts every `running` run, including
runs on offline conductors, plus `claimed` runs whose lease has not expired or
was never set. An expired running lease does not establish that its worker stopped.

When an eligible ticket is withheld by this count, the conductor logs:

```json
{"msg":"claim withheld: machine at capacity","reason":"machine_capacity","occupancy":9,"capacity":9,"reportedLoad":7,"retryAt":null}
```

Here `occupancy` is the admission count observed under the server's machine lock;
`reportedLoad` is the client's load estimate at that poll. The server refuses a
new run until counted occupancy drops below capacity. There is no fixed release
deadline for running runs: `retryAt: null` means unknown, not immediate eligibility.
The conductor keeps polling normally and can claim at the next poll after a slot
is freed. Admission order and the host ceiling are unchanged.

`idle, nothing to claim` means the server found no claimable candidate in its
bounded search, without a capacity refusal. It can include tickets excluded by
assignment, state, blockers, existing runs, or other claim gates. A client-side
`at capacity, nothing claimed` means reported load prevented a claim request.

To investigate apparent spare capacity, inspect the machine's conductors and their
claimed/running runs, including offline conductors. Confirm worker/session liveness
before using the normal run lifecycle to finish or fail abandoned work. Do not
infer that a running worker stopped from conductor status or an expired lease.

The HTTP contract is `201` with a run on success, `204` with no body when no
candidate is claimable, and `200` with `data: null` and
`meta.claim: {reason: "machine_capacity", occupancy, capacity, retry_at: null}`
for capacity withholding. Older clients safely treat that null data as idle;
updated clients still accept legacy `204` responses. Both server and client must
be updated to obtain the reason in conductor logs. A legacy server's `204` cannot
distinguish the two outcomes.

## Conductor lifecycle: identity, not paths (BB-450)

`bakers oven stop` finds its conductor by its `conductor_id` (machine id, project and variant) in the
control-plane record — never by comparing the signalled process's working directory against
`workspace_root`. That means `stop` (and `start`) work identically from the project root, from
`.bakers/`, or from a linked worktree. Before signalling, the pid is verified as a live process
whose command line identifies a bakers-conductor foreground loop, owned by the same OS user, on a
machine whose id matches this machine's own `machine_id` — never a colleague's conductor on another host, and
never a recycled pid that happens to share the number. With no pid on record, `stop` refuses and
says so; it never guesses which process to signal.

`bakers oven start` reports exactly one of three outcomes: **started** (pid + host),
**already running** (the live pid + heartbeat age), or **failed** (the reason) — and "started"
means a fresh heartbeat actually arrived, not merely that the spawn call returned. `start --force`
turns "already running" into a restart: a verified `SIGTERM`, a bounded grace period, an
escalation to `SIGKILL`, then a fresh spawn. If the running conductor cannot be verified or
stopped, `--force` **fails** rather than starting a second conductor on the same checkout.

## Multiple conductors per repo (BB-126 / BB-137)

A `.bakers/` dir may hold **several** configs — the default `conductor.config.js` plus any
`<variant>.conductor.config.js` — each a complete config bound to its own `bb_project` and its
own conductor (own variant, claims, worktrees). **Naming rule (BB-137):** a file is a
conductor config **iff** it is exactly `conductor.config.js` or ends with `.conductor.config.js`
(so `vite.config.js` and the near-miss `myconductor.config.js` are ignored). This is a **clean
break** from the earlier `<name>.config.js` variant naming — old variant files must be renamed.
Select one per invocation by conductor name (= file stem, the part before `.conductor.config.js`):

```bash
bakers oven once                       # the default conductor.config.js, or a sole lone config
bakers --conductor shop oven once      # → .bakers/shop.conductor.config.js
BB_CONDUCTOR=intra bakers oven once  # → .bakers/intra.conductor.config.js
bakers --conductor conductor oven once # → .bakers/conductor.config.js (the default, explicitly)
```

With no selector: `conductor.config.js` present → it is the default (used automatically); else a
single lone config → it (back-compat); else resolution errors and names the available stems plus
the selector. `--conductor` wins over `$BB_CONDUCTOR`, and an explicit `--config <path>` /
`$BB_CONDUCTOR_CONFIG` still wins over both. Two `conductor.config.js` cannot coexist in one
dir, so an ambiguous default is structurally impossible. A config sets no identity: the
`conductor_id` is derived from the machine id + `bakers.project` + variant (the file stem), so
co-located conductors are distinct by construction. A config with `conductor_id`, `machine_id`
or `label` is rejected; run `bakers init`. This is how a Drupal **multisite** repo maps
each site to its own bakers.build project. Full model: [`CONFIG.md`](CONFIG.md) › *Multiple conductors per repo*.

## Rebuilding after editing sources

The CLI runs the compiled `dist/`. After editing conductor or plugin sources, rebuild:

```bash
cd bakers-cli && pnpm install && pnpm run build:all   # = pnpm -r run build (every package + addon)
```

or just re-run `bakers-cli/scripts/setup.sh` (idempotent — it also refreshes the farm and
shim, and builds in the layered order `core → conductor → addons → ui → host`, which
`pnpm -r` does not guarantee on a fresh tree).

## herdr run-session layouts (BB-58)

When the executor is [herdr](addons/herdr), each run opens **one tab**
with the agent in the **root pane**. The executor is left **bare**
(`executor: herdrExecutor()` in `.bakers/conductor.config.js`) — it does **not**
hard-wire a diff pane into any state:

| State    | Executor panes | Human review surface |
|----------|----------------|----------------------|
| `coding` | none — agent terminal only. | — |
| `review` | none — agent in the root pane. | **hunk** (BB-55), opt-in, agent-driven, launched in the *human's* interactive pane. |

The review diff surface is **hunk**, not an executor-forced `git diff` pane. It is an
**optional, additive** surface that a project's `WORKFLOW.md` can request for the
human-confirm step of review. The selected review skill launches
`hunk diff <base>...HEAD` in the human's own pane when `hunk` is on `PATH` and the
run is interactive, and drives inline annotations with `hunk session comment apply`.
In a non-interactive/CI run hunk is simply skipped. BB-58 adds **no** executor
layout change — this is why the config ships a bare `herdrExecutor()`.

### The workspace tab's initial pane — `open` (BB-139/BB-234/BB-374)

Separate from the per-run agent tab above, the **workspace** tab (one per worktree,
created by `herdrWorkspace`) applies an `open` layout to its initial root pane, on a
**fresh worktree create only** — never on reuse, where the operator's panes already
exist and may already hold a running tool (and may already carry custom chrome labels).

Since BB-234 the shipped default renders the ticket the worktree belongs to, so a
fresh tab is not an anonymous shell prompt. BB-374 also labels the overview **tab**
`{identifier} · {title}` (title truncated to 30 characters with a trailing `...`
when longer) and the overview **pane** (`herdr pane rename`)
`{identifier} · {title}` (full title):

| `with: { open: … }` | initial pane |
|---|---|
| **absent** | the default — `bakers ui --ticket <IDENTIFIER>`, tab `{identifier} · {title@30…}`, pane `{identifier} · {title}` |
| `{}` | the bare empty tab — the documented **opt-out** (no command, no splits, no labels) |
| `{ command: '…', panes: [ … ], tabLabel?, panelLabel? }` | that command + optional chrome templates |

The variables expand in `command`, every `panes[].command`, `tabLabel`, and `panelLabel`:

| var | value |
|---|---|
| `{identifier}` | the ticket identifier `ensure()` was handed by the dispatcher — never re-derived from the branch |
| `{branch}` | the worktree's branch |
| `{title}` | the ticket title (BB-374) |
| `{worktreePath}` | the absolute checkout path |

An unknown `{key}` is left verbatim, so a brace-bearing command round-trips unchanged.
The whole layout is **best-effort**: a failing command or rename is logged through the
conductor logger and swallowed, so it can never wedge worktree creation or run
dispatch. Per-state run tabs keep their existing
`<identifier> · <state> #<run>` **tab** label for stop matching; their **pane** label
defaults to `{title}` via `default.panelLabel` / `states.<state>.panelLabel`.

> **Self-hosting checkouts** (a repo that builds its own `bakers`) must sequence the
> command after that build — `after_create` runs *after* the workspace is ensured. See
> this repo's own `.bakers/conductor.config.js` workspace slot for the sentinel-wait form.

### Click-to-edit: the spiceedit overlay

Clicking a changed file in the human's hunk pane opens it **editable** in a floating
**spiceedit** overlay — over the review layout, not replacing hunk or the agent.
herdr opens an overlay only via a plugin entrypoint, so spiceedit is wrapped as the
repo-local **`herdr/spiceedit`** plugin (linked by `setup.sh` step 7). It is opened
with:

```sh
herdr plugin pane open --plugin spiceedit --entrypoint edit --placement overlay \
  --env SPICEEDIT_FILE="<path>" --focus
```

The overlay hangs off the human's opt-in hunk pane, **not** an executor-declared pane.

**Open dependency (BB-55).** The intended trigger is hunk's *file-activate* hook
firing this with the selected file. That hook is not on this branch and its surface
is unverified, so until it lands the fallback is a **herdr keybinding** bound to the
plugin's `open-overlay` action — bind it in `~/.config/herdr/config.toml` and it opens
the overlay for `$SPICEEDIT_FILE`. Everything degrades gracefully: a missing
`spiceedit` or an unset path prints a message and closes cleanly.

**Requirements:** herdr **0.7+**; spiceedit needs **Go 1.22+**.

## Troubleshooting

- **`ERR_MODULE_NOT_FOUND: Cannot find package '@bakers-build/bakers'`** (or `@bakers-build/addon-*` /
  `@dropsh/*`) when a `bakers tools …` or `bakers auth …` command loads the config → the resolution farm or the
  addon build is missing/stale. **Re-run `bakers-cli/scripts/setup.sh`.**
- **`ERR_MODULE_NOT_FOUND: Cannot find package '@bakers-build/plugin-<name>'`** → the config still
  names a pre-BB-224 addon package. Rename it to the `@bakers-build/addon-*` name in the `.bakers/` configs.
- **`bakers: command not found`** → `~/.local/bin` is not on your `PATH`. Add it:
  `export PATH="$HOME/.local/bin:$PATH"`.
- **`bakers: not in a bakers worktree and no global bakers on PATH`** → you are outside any bakers.build
  worktree and have no global `bakers`. `cd` into a clone/worktree, or re-run setup there.
- **Auth failures** → confirm `BB_CONSUMER_SECRET` is exported and `bakers auth
  login` has been run; check `bakers auth status`.

## Agent aliases

The Claude, Codex, Grok, Kimi, OpenCode and Pi addons declare their candidates in their presets.
Run `bakers agents` to see effective aliases, descriptions, harnesses, model bindings, filters,
the default agent and routes as JSON. Claude ships `opus` and `sonnet`; other addons expose
their harness alias. A missing machine policy enables every addon candidate and infers the first
one as the default.
Host-local variants may add family names such as `k3-pi` without changing a published addon.

Tickets select an alias with `agent:<alias>`, optionally narrowed to a state with
`agent:<alias>@coding`. Qualification proposes a suitable alias and writes it only after human
confirmation; unattended qualification leaves the choice to defaults. Machine filters, nested
catalog overlays, reserved default route, custom variants and priority fallback are described in
[the configuration guide](CONFIG.md#named-agents-and-machine-policy).
