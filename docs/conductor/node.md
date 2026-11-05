# Node Conductor Operations

The Node conductor is the Phase 4 worker runtime for bakers.build. It registers one or
more conductor identities with Drupal, claims tickets through the bakers.build
`claim-next` JSON:API endpoint, and starts local agent sessions through exactly
one registered spawn plugin.

## Installation

For repository development, install and build the pnpm workspace from the
`bakers-cli/` directory:

```bash
cd bakers-cli
pnpm install
pnpm run build:all
```

After the package is published, operators can install the CLI globally:

```bash
npm i -g @bakers-build/conductor
```

The executable is `bakers-conductor`.

## Files

```text
~/.config/bakers-conductor/conductor.config.js  # One dropsh-superset config:
                                              # site + plugins + conductors[].
                                              # Override with --config or
                                              # BB_CONDUCTOR_CONFIG.
                                              # DROPSH_CONFIG points to this
                                              # same file for inherited dropsh.
~/.config/dropsh/<host>.json                  # Session store only, managed by
                                              # bakers auth login/status.
```

The conductor uses a single config file. There is no separate plugin registry
or YAML file. Auth plugins and the spawn plugin live together in the
`plugins` array.

## Config

Example `conductor.config.js`:

```js
import { oauth2Plugin } from '@dropsh/plugin-oauth2';
import { herdrSpawnPlugin } from '@bakers-build/plugin-herdr';

export default {
  site: {
    base_url: 'https://bakers.example.com',
    jsonapi_prefix: '/jsonapi',
  },
  machine: 'worker-01',
  plugins: [
    oauth2Plugin({
      tokenUrl: 'https://bakers.example.com/oauth/token',
      clientId: process.env.BB_CLIENT_ID,
      clientSecret: process.env.BB_CLIENT_SECRET,
    }),
    herdrSpawnPlugin(),
  ],
  conductors: [
    {
      project: 'platform',
      // Optional narrowing. Omit or leave empty to serve every claimable state
      // in the project; list states to restrict this entry to them.
      states: [],
      // Optional: override the default project-instruction pointer.
      // Placeholders: {identifier}, {state}, {runUuid}.
      prompt: 'You are working ticket {identifier}, current state: {state}. Read the ticket and all comments, then execute only the ordered "State: {state}" section of ./WORKFLOW.md. Do not start or prepare a later state.',
      workspace: '/srv/bakers/workspaces/platform',
      poll_interval_ms: 5000,
      lease_seconds: 300,
      retry: {
        base_backoff_ms: 2000,
        max_backoff_ms: 300000,
      },
      hooks: {
        after_create: 'git init',
        before_run: 'git status --short',
      },
    },
  ],
};
```

Config keys:

| Key | Required | Default | Meaning |
|---|---:|---|---|
| `site.base_url` | yes | none | bakers.build Drupal base URL. |
| `site.jsonapi_prefix` | no | `/jsonapi` | JSON:API prefix for dropsh and `BbClient`. |
| `machine` | no | host name | Prefix for generated conductor machine IDs. |
| `plugins` | no | `[]` | dropsh plugins plus exactly one bakers.build spawn plugin. |
| `conductors[].project` | yes | none | `bb_project.name` served by this conductor entry. |
| `conductors[].states` | no | `[]` (all claimable states) | Optional narrowing. Empty/absent = serve every state marked `claimable` in the project; a non-empty list restricts this entry to those states. |
| `conductors[].workspace` | yes | none | Root directory for ticket workspaces. |
| `conductors[].label` | no | machine ID | Human label for the Drupal conductor entity. |
| `conductors[].prompt` | no | built-in project-instruction pointer | Agent prompt template. Placeholders: `{identifier}`, `{state}`, `{runUuid}`. The Conductor names no agent skill and does not parse the file; projects compose any capabilities directly in `WORKFLOW.md`. |
| `conductors[].poll_interval_ms` | no | `5000` | Delay between daemon ticks. |
| `conductors[].lease_seconds` | no | `300` | Lease duration requested for conductor and run leases. |
| `conductors[].retry.base_backoff_ms` | no | `2000` | Initial retry delay after failed plugin state. |
| `conductors[].retry.max_backoff_ms` | no | `300000` | Maximum retry delay. |
| `conductors[].hooks.after_create` | no | none | Shell command run once after workspace creation. |
| `conductors[].hooks.before_run` | no | none | Shell command run before each plugin start. |
| `conductors[].hooks.after_run` | no | none | Shell command run after terminal run release. |

Each `conductors[]` entry registers one conductor for one project. A single
daemon process can serve multiple projects, sharing the same transport,
session store, and spawn plugin.

## Auth

Authenticate with the same config file:

```bash
bakers auth login --config ~/.config/bakers-conductor/conductor.config.js --provider oauth2_client_credentials
bakers auth status --config ~/.config/bakers-conductor/conductor.config.js
```

When the conductor config loads, the CLI sets `DROPSH_CONFIG` to the loaded
`conductor.config.js`. Agent sessions call the server's named tools, natively
through the MCP connector or with `bakers tools <wire name> --data @args.json`
(see `docs/configuration/clients/tools.md`).

The conductor passes `DROPSH_CONFIG`, `BB_RUN_UUID`, and `BB_TICKET_UUID`
into every spawned session.

## Spawn Plugins

Register exactly one spawn plugin per conductor process:

- `fakeSpawnPlugin()` is deterministic and intended for tests and smoke runs.
- `herdrSpawnPlugin()` starts real terminal sessions through the `herdr` CLI.

Registration activates the plugin. There is no selection key; more than one
spawn plugin in `plugins` is a config error.

Use `spawn-test` to verify the registered plugin without Drupal:

```bash
bakers-conductor --config ./conductor.config.js spawn-test
bakers-conductor --config ./conductor.config.js spawn-test --command 'claude' --timeout 120
```

The command creates a synthetic run, logs session and state transitions, exits
with `0` for `exited`, and exits with `1` for `failed` or timeout.

### Agent-pane shell marker (history opt-in)

The herdr executor starts the agent by typing its launch command into an
interactive `$SHELL` (`herdr pane run`). With oh-my-zsh's `share_history` that
agent-authored command lands in the shared `~/.zsh_history`, so it surfaces in
every interactive shell's Ctrl-R — commands you never typed.

To let your shell isolate those panes, bakers exports `BB_AGENT_SHELL=1` into
the environment of every **agent** pane it opens. The marker is present at shell
startup, so `.zshrc` can react to it. Which panes carry it:

| Pane | Marker | Why |
| --- | --- | --- |
| Executor run tab, root pane (`tab create --env`) | yes | the agent itself |
| Executor run tab, configured layout panes (`pane split --env`) | yes | part of the agent's run tab |
| TUI-hosted agents, `bakers ui` → `n` (`tab create` / `pane split --env`) | yes | agents you attach to |
| Workspace open-layout pane on a fresh worktree | **no** | that pane is yours, not an agent's |

The last row is the point of the split: the open-layout pane is where *you* land
when a worktree opens, and the opt-in below unsets `HISTFILE`. Marking it would
silently drop the history of a pane you type in. Both paths share the same
`applyPaneLayout` primitive, so the marker is passed per caller rather than baked
into it.

Nothing changes unless you opt in. Add this to your `~/.zshrc`, **after**
oh-my-zsh is sourced so it overrides `share_history`/`HISTFILE`:

```zsh
# bakers.build: keep agent-pane commands out of my shared shell history (opt-in).
# Add AFTER oh-my-zsh is sourced so it overrides share_history/HISTFILE.
if [[ -n "$BB_AGENT_SHELL" ]]; then
  unset HISTFILE
fi
```

Notes:

- **Opt-in and per-user.** Without this snippet, history behaviour is exactly
  as it is today — the marker alone changes nothing.
- **Your own terminals are unaffected.** They never have `BB_AGENT_SHELL`
  set, so the guard is false there and your typed commands are saved as usual.
- **Attaching to an agent pane.** That pane's `HISTFILE` is unset, so commands
  you type there are also not saved on disk — the agent pane is agent-owned.
- **bash users** can use the same guard with `unset HISTFILE`.
- The run's own env vars (`BB_ID` and friends) do **not** travel this way —
  they stay inline `KEY='value'` prefixes on the agent command, so no secret
  moves into a pane environment.

## Running

Start the daemon:

```bash
bakers-conductor --config ~/.config/bakers-conductor/conductor.config.js start
```

Run a finite smoke loop:

```bash
bakers-conductor --config ./conductor.config.js start --once
```

`--once` registers configured conductors and runs two ticks per conductor. It
is intended for integration and local smoke tests.

## Reconciliation And Retry

Each tick heartbeats the conductor, reconciles tracked local runs, then claims
new work while local slots are available. Reconciliation renews active leases,
releases terminal runs, stops sessions whose ticket state has drifted away
from `state_at_start`, and keeps locally tracked runs alive when transient
read errors occur.

After a run reaches a terminal state, Drupal blocks another standard claim for
that ticket while it remains in the same workflow state. This avoids immediate
double-dispatch after a successful run that did not transition the ticket.
Future continuation turns need an explicit continuation policy instead of
falling back through `claim-next`.

Plugin failures move the existing run to `retrying`. The supervisor applies
exponential backoff using `retry.base_backoff_ms`, capped by
`retry.max_backoff_ms`, and relaunches only after the ticket still matches the
state captured in `state_at_start`. It does not churn a new run for the same
claimed ticket.

## Security

The conductor transport is dropsh: OAuth, HTTP, JSON:API, config loading, and
session storage are not reimplemented here. The Drupal user used by the
conductor needs only the permissions described in
[api.md](api.md): register/heartbeat conductors, claim tickets, and manage its
own run leases.

The conductor never writes ticket content or ticket state. Ticket updates,
comments, subticket creation, and footprint logs are agent-session write-back
operations through the server's named tools (`bakers tools`), guarded by session scope and
Drupal validation. See [api.md](api.md) and SPEC section 13 for the broader
security model.
