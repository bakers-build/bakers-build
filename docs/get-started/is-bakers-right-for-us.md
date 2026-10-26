# Is bakers.build right for us?

**bakers.build does not care about your stack or your terminal. Both are addons you can swap.**

bakers.build keeps tickets, states and the rules in your repository. Everything around it comes from two sides you choose:

| Your machine | bakers.build | Your project |
|---|---|---|
| Your agent and its subscription. Your workspace manager, which keeps agent sessions open. | Tickets, states, skills, runs. Stays the same whatever you plug in. | Your stack, your checks and standards in `WORKFLOW.md`, the skills that fit your stack. |

## What works today

| | Today | Coming soon | Build your own |
|---|---|---|---|
| Agent | Claude Code, Codex, Grok, Kimi, OpenCode, Pi | | an [agent addon](/addons/) |
| Workspace manager | herdr | tuios | an [executor addon](/addons/build/contracts) |
| Development environment | DDEV, Docker Compose; anything your project's hooks can start | | [hooks](/advanced/configuration/hooks) per project |
| Recipes and runtimes | the Matt method; DDEV | | [a recipe](/advanced/development/write-a-step-skill) for your method |
| Sharing previews | Cloudflare and frp tunnels | | a [transport addon](/addons/ports) |

Your stack needs no dedicated skill: `WORKFLOW.md` names the skills and checks for it, and a developer writes a recipe only for a different engineering method.

## Where things run and what is stored

Your code stays in git worktrees on your machines; agents call their model providers with your own keys. The bakers.build server holds tickets, states, handoff comments and each run's footprint (tokens, turns, tool calls). On a self-hosted server, run transcripts upload to your own server and stay there; turn that off per conductor with `capture_logs: false`. On hosted bakers.build, the server keeps handoffs and footprint only. The full list: [Where your code and data live](/advanced/where-your-data-lives).

## Hosted or self-run

Like GitLab, both work. **Hosted:** your team gets accounts on a bakers.build server someone else runs; you set up workspace, project and workers. **Self-run:** you also install and update the [server](/advanced/server). Tickets, skills and agents behave the same either way: [Hosted or self-run](/advanced/hosted-or-self-run).

## Who may do what

Workspace ranks and team roles decide who sees and changes which tickets, time and billing. [Who sees what](/daily-work/who-sees-what) explains them in plain words; review, merge and deployment stay explicit human decisions.

## Growing

Start on one laptop. When it becomes the limit, add a [worker server](/advanced/worker-server) or run [conductors for the team](/advanced/conductors#run-a-conductor-for-a-team); the tickets do not change.

## Next

[Set up bakers.build](/get-started/install) on your machine, or [connect your project](/get-started/connect-a-project).
