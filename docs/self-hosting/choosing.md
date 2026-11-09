# Hosted or self-run

**Use a bakers.build server someone else runs, or run your own. Tickets, skills and agents behave the same.**

bakers.build has one server component, the control plane: it holds workspaces, projects, tickets, comments and runs, and owns every state change. Everything else, conductors, agents and worktrees, runs on your machines and connects outward to it. Like GitLab, you choose where that server lives.

| | Hosted | Self-run |
|---|---|---|
| Who runs the server | The operator of the hosted instance | You |
| Your account | Created for you on that instance; you sign in from your agent or the browser | You create the instance administrator, then invite your team |
| Workspace, project, team | You set them up | You set them up |
| Conductors and agents | On your machines, as always | On your machines, as always |
| Run transcripts | Not stored; the server keeps handoffs and footprint only | Off by default; stored on your own server only when you set `FEATURE_FLAG_RUN_LOG_STORAGE` and a workspace lead opts in ([Run-log storage](/self-hosting/server#run-log-storage)) |
| Updates | The operator updates the server; you update the CLI and plugin | You update server, CLI and plugin ([Update bakers.build](/configuration/machine/updates)) |
| Mail, backups, domain | The operator's | Yours ([Server](/self-hosting/server)) |

### Choosing

Start hosted when a bakers.build instance is available to you: nothing to run, and switching later moves no skills or workflows. Run your own when your tickets and handoffs must stay on your infrastructure, or when you need your own OAuth clients, mail or retention rules.

### Moving from one to the other

Your repositories carry `WORKFLOW.md`, `.bakers/conductor.config.js` and the skills; they work against any server. Tickets and their history belong to the server they were created on and are not migrated automatically.
