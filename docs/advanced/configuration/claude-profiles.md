# Measure Claude runs

Turn on measurement and the state-group settings for the Claude aliases this machine loads from `@bakers-build/addon-claude`. Each Claude run then starts through the addon's measure wrapper, which runs a logging proxy for exactly that process and applies the settings for the run's state.

**You need:** Claude Code and `node` on the conductor's `PATH`, `@bakers-build/addon-claude` in the machine `addons`, and a project whose `.gitignore` ignores `assets-ai/`. Ignore `.bakers/claude-measure.settings.json` too to keep the settings in the worktree; otherwise they go to a temporary file.

1. Set `measure: true` on the Claude entry in `addons` of `~/.bakers/machine.config.js`. Keep the rest of `addons` and the `agents` object you already have:

   ```js
   addons: [
     {
       use: '@bakers-build/addon-claude',
       with: { measure: true },
     },
   ],
   agents: {
     enabled: ['opus', 'sonnet'],
     default_agent: 'opus',
   },
   ```

   The option also works on a single `catalog` entry, so you can measure one alias only.

2. Restart the conductor and dispatch a ticket. The launch command becomes `node …/measure/claude-measure.mjs claude …` with `--setting-sources project,local`, `--settings .bakers/claude-measure.settings.json` and an empty `--mcp-config` under `--strict-mcp-config`. `--setting-sources project,local` drops your user settings (`~/.claude/settings.json`), including their `env`, hooks, permissions and `apiKeyHelper`; a machine that authenticates through those needs them in the project's local settings instead.

3. Verify after the run: the worktree has `.bakers/claude-measure.settings.json` where git ignores it, and `assets-ai/<TICKET>/node/<run uuid>/` has one Markdown log per request.

**Done when:** a Claude run on this machine writes those logs.

::: tip Ask your AI
"Enable Claude measurement on this machine by setting `with.measure: true` on `@bakers-build/addon-claude`."
:::

## What the wrapper does

| Step | Behaviour |
|---|---|
| Settings | Copies the state group's file to `.bakers/claude-measure.settings.json`, with the project's own `enabledPlugins` from `.claude/settings.json` and `.claude/settings.local.json` on top. Where git does not ignore that path, it writes a temporary file instead, points `--settings` at it and deletes it at the end |
| Proxy | Starts `measure/agent-proxy.mjs` on `127.0.0.1` with a kernel-assigned port and sets `ANTHROPIC_BASE_URL` for Claude |
| Logs | Writes to `assets-ai/<BB_TICKET_IDENTIFIER>/node/<BB_RUN_UUID>/`, one directory per run, and exports that path to Claude as `BB_PROXY_LOG_DIR`; errors go to `agent-proxy.errors.log` there, never into the terminal |
| End | Closes the proxy when Claude exits and passes on Claude's exit code; a Claude killed by a signal yields 128 plus the signal number |

The proxy lives and dies with the Claude process, so a conductor restart, `bakers conductor poll` or a re-dispatch leaves no listener behind. If the proxy cannot start, for example because git does not ignore the log directory, Claude still runs with the settings, unmeasured, and the wrapper prints the reason. Omit `measure` and Claude launches unchanged.

## State-group files

The files are keytec profiles: they name keytec's plugins. Shipped in the addon under `measure/`:

| File | States | Plugins | Effort |
|---|---|---|---|
| `keytec-plan.json` | qualification, spec, diagnose | bakers, superpowers, mattpocock-skills, keytec-drupal | high |
| `keytec-coding.json` | coding | plan's plugins plus designbook, designbook-drupal, designbook-css-tailwind | high |
| `keytec-review.json` | review | same as plan | high |
| `keytec-ops.json` | pre_deployment, post_deployment, verifying, summary | bakers | medium |

Why each plugin stays: `bakers` carries the workflow skills where a project has no own copy; superpowers and mattpocock-skills are the two `WORKFLOW.md` skill sets; keytec-drupal is the Drupal skill row; the designbook plugins serve the Designbook skill row in `WORKFLOW.md`, which only coding uses. Ops states run bakers.build skills only. Plan and review files are identical.

Every file sets `autoMemoryEnabled: false` and denies unused built-in tools (scheduler, worktree, Claude Workflow). It also denies Claude in Chrome and the claude.ai session tools (artifacts, design sync, feedback, onboarding, push), about 28 KB per interactive request. Coding and ops also deny WebSearch; plan and review keep it for research. `Agent` and `AskUserQuestion` stay. Plugins a project or local settings file enables are still added.

## Manual proxy

To capture a shell `claude` session without the conductor, run the proxy from the addon. It listens on `127.0.0.1:8787`:

```bash
BB_TICKET_IDENTIFIER=BB-569 node bakers-cli/addons/claude/measure/agent-proxy.mjs
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
```

The identifier is the ticket's `identifier`, not `BB_ID`.
