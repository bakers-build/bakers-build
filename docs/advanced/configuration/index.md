# Which file owns what

bakers.build splits configuration by owner, so your login never lands in a repository and one laptop's settings never change a team's project.

| File | Location | Owns | Commit |
|---|---|---|---|
| Machine | `~/.bakers/machine.config.js` | Host identity, capacity, tunnel policy, agent harnesses and routes | No |
| Connection | `~/.bakers/bakers.config.js` or `~/.bakers/connections/<id>.js` | Server URL, sign-in, connection addons | No |
| Checkout selector | `.bakers/connection.config.local.js` | The name of one connection | No |
| Conductor config | `.bakers/conductor.config.js` | Project identity, execution wiring, scheduling, hooks | Yes |
| Local engine inputs | `.bakers/conductor.config.local.js` | Only values the conductor config imports from it | No |
| Project rules | `WORKFLOW.md` | Skills, standards, checks | Yes |

`BB_HOME` names the `~/.bakers` directory itself and moves the machine and connection files together.

Check the result with `bakers config check --scope all`. Add `--online` to also verify sign-in and project access.

## Tasks

| I want to | Go to |
|---|---|
| Choose agents and models, route states to agents | [Choose agents and models](/advanced/configuration/agents-and-models) |
| Measure Claude runs and apply state settings | [Claude profiles](/advanced/configuration/claude-profiles) |
| Run a command when a worktree is prepared or removed | [Add lifecycle hooks](/advanced/configuration/hooks) |
| Share a running preview | [Ports](/addons/ports) |
| Browse a run's local evidence | [Artifacts](/addons/bakers-ui-artifacts) |
| Update the CLI, configuration and project files | [Update bakers.build](/advanced/configuration/update) |
| Connect your own claude.ai account to bakers.build | [Connect Claude.ai to bakers.build](/daily-work/claude-ai) |

## Reference

Every field of the machine and connection files is in [Machines](/advanced/machines) and [Connections](/advanced/connections). The conductor file is in [Conductor configuration](/advanced/conductor-config), and old keys are repaired as described in [Configuration migration](/advanced/migration).
