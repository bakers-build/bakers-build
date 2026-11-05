# Add lifecycle hooks

Run a repository command or an addon's listener at a worktree's lifecycle points, including a freeze.

**You need:** a committed `.bakers/conductor.config.js`, the standard herdr executor and a command that is safe to run repeatedly.

1. Add a `hooks` object to `.bakers/conductor.config.js`. Each value is one shell command string. This complete file adds five hooks to an existing config:

   ```js
   export default {
     bakers: { project: 'demo' },
     addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
     hooks: {
       after_create: 'pnpm install --frozen-lockfile',
       before_run: 'git status --short',
       after_done: 'bakers ports down mailpit',
       on_freeze: 'ddev stop',
       on_resume: 'ddev start',
     },
   };
   ```

   Keep existing values; script longer commands. `bakers config init --scope project` can write `hooks` from `--after-create '<command>'` and `--after-done '<command>'`.

2. Make every command repeatable. It runs through `sh -c` in the ticket's worktree with your permissions, so its tool must be on the conductor's `PATH`.

3. Verify:

   ```sh
   bakers config check --scope project
   ```

   It proves only that the file is valid, so also run the command twice in a disposable worktree and watch one dispatch.

**Done when:** a new worktree shows the effect of `after_create` and the log shows no `lifecycle hook failed` line.

::: tip Ask your AI
"Read this repository's conductor config and add an `after_create` hook using the project's existing install command."
:::

## When each hook runs

| Hook | Runs | Use for |
|---|---|---|
| `after_create` | Every dispatch, after the worktree exists, including a reused worktree | Convergent dependency setup |
| `before_run` | After `after_create` (and a fresh worktree's opening layout), before the agent starts | Quick refresh, launch env |
| `after_run` | After an ended run's worker stopped, before the run is closed; at once when a launch fails | Stopping a run's sidecar |
| `after_done` | During cleanup of a finished ticket, before the worktree is removed | Releasing local resources |
| `on_freeze` | Once when a poll sees the ticket [frozen](/get-started/daily-work/freeze-a-ticket), in its worktree on this machine | Stopping local services |
| `on_resume` | Once when a poll sees it unfrozen | Restarting them |

Runs resume and a failed close write repeats `after_run`, so tolerate repetition. If the worktree directory is gone, `after_run` and `after_done` run nothing.

## Environment

`after_create`, `before_run`, `on_freeze` and `on_resume` inherit the conductor's environment, these values and the ticket's environment variables:

| Variable | Value |
|---|---|
| `BB_URL` | Server URL of the selected connection |
| `BB_ID` | Ticket UUID |
| `BB_TICKET_IDENTIFIER` | Ticket identifier |
| `BB_STATE` | Run's start state; current state for freeze hooks |
| `BB_RUN_UUID` | Current run UUID; unset for freeze hooks |
| `BB_TUNNEL` | `1` if the machine allows preview tunnels, else `0` |
| `WORKSPACE_ROOT` | Checkout root; the working directory is the ticket worktree |
| `TICKET_URL` | Origin issue URL, when there is one |
| `BB_PROJECT`, `BB_PROJECT_ID` | Project name and UUID, when known |
| `BB_WORKSPACE`, `BB_WORKSPACE_ID` | Ticket workspace name and UUID, when known |
| `BB_WORKSPACE_IDS` | Comma-separated reachable workspace UUIDs |

Optional values are omitted rather than empty. The `after_run` command gets them rebuilt from the current ticket; the `after_done` command gets none of them.

## Failure behavior

Hooks are best effort: a failing command or listener is logged and dispatch or cleanup continues. A required gate belongs in the `WORKFLOW.md` checks. A top-level `hooks` object replaces the herdr addon's `with.hooks` as a whole.

## Provision on an agent's request

`provision_up` never runs on its own. The conductor offers it to runs as the [tool](/addons/build/tools#shipped-tools) `provision_up(profile?)`, so a sandboxed agent can reinstall its environment without trusting the runtime's CLI. The value is one command, or a command per profile; the agent picks a configured profile, never the command:

```js
hooks: {
  provision_up: {
    'recipe-test': 'ddev init --provider recipe-test',
    'existing-config': 'ddev init --provider existing-config',
  },
},
```

It runs through `sh -c` in the run's worktree with the conductor's environment, up to 30 minutes. Unlike the other hooks it is not best effort: a non-zero exit reaches the agent as a tool error. Like `after_create`, it runs worktree code with your permissions.

## Add a listener from an addon

A conductor addon's preset can export a [`hooks` accumulator](/addons/build/contracts#surfaces-and-extension-points); each listener defines any of these slots:

```ts
import type { Preset } from '@bakers-build/conductor/contract';

export const hooks: Preset['hooks'] = (acc) => [
  ...acc,
  {
    id: 'demo-sidecar',
    async before_run(ctx) {
      ctx.env.DEMO_SIDECAR_URL = 'http://127.0.0.1:4599';
    },
    async after_run(ctx) {
      // stop what before_run started for ctx.run?.uuid
    },
  },
];
```

Listeners run awaited in `addons` order, children first, before the slot's project command. `ctx` carries `worktreePath`, `ticket`, `state`, `env` and `run`. At dispatch a key added to `env` reaches later listeners, the command and the agent; reserved keys (`BB_*`, `WORKSPACE_ROOT`, `TICKET_URL`) and invalid entries are restored. Never log `env` values.

At `after_run` and `after_done`, `ctx` is rebuilt from the records, also after a restart: find what you started by `ctx.run.uuid`.

## Clean up a preview

`after_done: 'bakers ports down mailpit'` stops a tunnel opened with `bakers ports up mailpit`. See [Ports](/addons/ports).
