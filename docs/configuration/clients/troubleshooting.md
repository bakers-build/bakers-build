# Troubleshooting

Find the failing layer with one check, then apply its fix; a passing offline check proves nothing about login or a real run.

Start with these three commands and keep their output when you ask for help:

```sh
bakers --version
bakers config check --scope all --online
bakers info
```

The check prints the selected connection, how it was selected and its file; `bakers info` prints the resolved project and workspace.

## Symptom, first check, fix

| Symptom | First check | Fix |
|---|---|---|
| `bakers` is not found | `npm prefix -g`; is its `bin` directory on `PATH` in this terminal? | Add it, then open a new terminal or restart the IDE. See [Install and sign in](/provision/machine) |
| The AI cannot find `init`, `bb-init-project` or another bakers.build skill | Is the bakers.build plugin enabled in this agent session? | Follow [skill installation](/skills-and-workflows/skills) and start a fresh session |
| 401 or a login error | `bakers auth status` | `bakers auth login`. If the session is valid and access is still denied, ask the operator to fix your workspace or project membership |
| Wrong server or wrong project | The `Connection:` line of `bakers config check` and the output of `bakers info` | Remove a stray `.bakers/connection.config.local.js`, or select the right name in it. The project comes from `bakers.project` and `bakers.workspace` in `.bakers/conductor.config.js` |
| Project name matches several workspaces | `bakers info` shows the wrong workspace | Set `bakers.workspace` in the committed config; see [Connect your project](/get-started/connect-a-project) |
| The check reports an old configuration shape | The finding names the file and key | `bakers config upgrade --scope all --dry-run`, review it, then apply; see [Update bakers.build](/configuration/machine/updates) |
| No agent is available | `bakers agents` prints an empty catalog | Add the harness and a default to the machine agent policy ([Agents and models](/agents/guide)). Make sure the harness is installed and logged in; a bakers.build login does not log it in |
| `herdr` is missing or fails | `herdr --version`, then `herdr workspace list` | Install herdr ([Prepare a machine](/provision/machine)); start it with `herdr` so a session is running, in the same terminal that starts the conductor |
| The conductor is idle | `bakers oven status` shows `online`? | The ticket must name this conductor, be in a state it serves, have closed blockers and a free slot. `bakers oven --log-level debug once` runs one logged cycle. See [Conductors](/configuration/project/conductors) |
| `sandbox unavailable` or `claims withheld` in `.bakers/log.txt`, or runs fail with `Launch failed: exit 1` | `bakers oven check` | Install the tool it names, or allow user namespaces; see [Sandbox prerequisites](/provision/security/execution#sandbox-prerequisites). The next cycle claims without a restart |
| A run is `running` but nothing happens | `herdr tab list` for the ticket's tab | The agent is probably waiting for your answer in that tab |
| A setup hook failed but the worker still started | `.bakers/log.txt` in the checkout | Run the hook command by hand in the worktree and fix it; see [Hooks](/configuration/project/hooks) |
| The Ports or Artifacts tab is missing | The `addons` list of the connection that `bakers ui` actually uses | Add the addon there; see [Addons](/addons/configure) |
| A shared preview link does not open | Is the local server up? `bakers ports list`, then `bakers ports status` | Start the service, then share it again with `bakers ports up <service-key>` |

## If the failure is not listed

Repair the layer that failed and keep the rest: a broken login does not require a new project or a new server. Read the finding's file path and its recheck command, fix that, and rerun the command that failed.

::: tip Ask your AI
"Run the three checks from the troubleshooting page, name the failing layer and propose the smallest repair."
:::
