# Security

Security spans account access, the worker host, project configuration and preview exposure. Keep agent-specific settings in [Agents execution security](/configuration/agents/execution-security).

## Credentials and access

Authorize chat connectors with your own account. [API keys and service accounts](/configuration/security/credentials) explains issuing, revoking and limiting credentials. Keep connection files under `~/.bakers` private; sign-in tokens live in dropsh's per-host `~/.config/dropsh/` store. [Connections](/configuration/connector/connections) owns the authentication profiles and file permissions.

Never put credentials in tickets, README files or committed conductor configuration. Ignore `.bakers/*.local.js`, `.bakers/log.txt` and `assets-ai/`; verify with `git check-ignore` during [project setup](/get-started/connect-a-project).

## Roles and permissions

**Your rights come from your rank in the workspace. Your teams decide which projects you see.**

### Workspace ranks

| Rank | You can |
|---|---|
| **Admin** | Everything in the workspace: invite people, manage members, teams and settings, see every project, delete tickets. |
| **Contributor** | Work: create and edit tickets, assign, freeze and cancel them, create projects, register your own conductor, record your own time. |
| **Guest** | Read tickets, comments, projects and teams. Change nothing. |

The person who created the workspace has every right in it. Creating or deleting a workspace itself is reserved for the instance administrator.

### Teams

A team makes its projects visible to its members. You see **every ticket of every project you can see**; tickets are never filtered by person.

| Team role | Adds |
|---|---|
| **Member** | Sees the team's projects. |
| **Lead** | Edits the team's projects and billing accounts, sees the team's statistics and the recorded hours of active members. |
| **Owner** | Also manages who is in the team. |

### In short

| You want to | You need |
|---|---|
| See a project and its tickets | Membership in one of its teams, or Admin |
| Create, assign, freeze or cancel a ticket | Contributor |
| Review a ticket | To be listed under **Reviewers** on that ticket |
| Record your time | Contributor; only you can edit your entries |
| See a teammate's hours | Team Lead, for active members of your team |
| Manage billing accounts | Team Lead, Team Owner or Admin |
| Change a conductor or machine | To be its owner |
| Invite someone | Admin |

Another workspace is invisible to you, even its name. An API key you create acts as you, with your current rights, for at most a year.

Review, merge and deployment stay explicit human decisions, whatever your rank.

## Agent execution boundaries

Claude and Codex default to their OS sandbox. Verify [sandbox prerequisites](/configuration/agents/execution-security#sandbox-prerequisites) as the conductor user before dispatch. Config roots, provider credentials and readable paths need separate consideration; a worktree is not a full security boundary. Other harnesses do not acquire the same sandbox simply by running under bakers.build.

[Execution security](/configuration/agents/execution-security) owns modes, allowlists, environment filtering and limitations. Package-specific flags stay with [agent addons](/addons/). Review commands from untrusted ticket text against the current scope. Hooks run with the worker's permissions; failures do not stop dispatch, so required readiness checks belong in `WORKFLOW.md`.

## Public previews and ports

Localhost previews are local by default. A public tunnel can expose the application to anyone with the URL while it runs; review authentication, sample data and secrets before sharing. Machine `tunnel: true` permits a single ad hoc preview; [Ports](/addons/ports) has separately configured transport policy. Stop tunnels when their purpose ends.

Isolate each worktree's service names, ports and data. Cleanup that deletes a worktree's database, without a snapshot, loses its data; export anything needed first. Native processes and Compose services also need scoped cleanup.

## Hosting and data

# Hosted or self-run

**Use a bakers.build server someone else runs, or run your own. Tickets, skills and agents behave the same.**

bakers.build has one server component, the control plane: it holds workspaces, projects, tickets, comments and runs, and owns every state change. Everything else, conductors, agents and worktrees, runs on your machines and connects outward to it. Like GitLab, you choose where that server lives.

| | Hosted | Self-run |
|---|---|---|
| Who runs the server | The operator of the hosted instance | You |
| Your account | Created for you on that instance; you sign in from your agent or the browser | You create the instance administrator, then invite your team |
| Workspace, project, team | You set them up | You set them up |
| Conductors and agents | On your machines, as always | On your machines, as always |
| Run transcripts | Not stored; the server keeps handoffs and footprint only | Off by default; stored on your own server only when you set `FEATURE_FLAG_RUN_LOG_STORAGE` and a workspace lead opts in ([Run-log storage](/configuration/project/server#run-log-storage)) |
| Updates | The operator updates the server; you update the CLI and plugin | You update server, CLI and plugin ([Update bakers.build](/configuration/machine/updates)) |
| Mail, backups, domain | The operator's | Yours ([Server](/configuration/project/server)) |

### Choosing

Start hosted when a bakers.build instance is available to you: nothing to run, and switching later moves no skills or workflows. Run your own when your tickets and handoffs must stay on your infrastructure, or when you need your own OAuth clients, mail or retention rules.

### Moving from one to the other

Your repositories carry `WORKFLOW.md`, `.bakers/conductor.config.js` and the skills; they work against any server. Tickets and their history belong to the server they were created on and are not migrated automatically.



# Where your code and data live

**Your code stays in git on your machines. The server holds tickets, states, handoffs and run footprints.**

| What | Where | Notes |
|---|---|---|
| Your repository and worktrees | Your machine, `<checkout>-worktrees/` or the configured `worktreeDir` | One git worktree per ticket; removed when the ticket is done or cancelled |
| Tickets, comments, states, labels | The bakers.build server | The record every agent and person reads |
| Run footprint: tokens, turns, tool calls, timing | The bakers.build server | Shown on each run; what the statistics count |
| Run transcripts | Your own server when self-run and opted in; nowhere on hosted bakers.build | Uploaded at the end of a run only when the server's [run-log storage](/configuration/project/server#run-log-storage) allows it for the workspace; `capture_logs: false` keeps them local regardless |
| Agent sessions and model traffic | Between your machine and your model provider | provider keys stay on the worker; stored run transcripts may contain prompts and tool output |
| Machine identity, capacity, agent catalog | `~/.bakers/machine.config.js` | Private file, not in git |
| Server address and sign-in | `~/.bakers/bakers.config.js` or `~/.bakers/connections/<id>.js` | Private; a device-code sign-in stores no secret, client-credential setup writes the secret into the private connection file |
| Which connection a checkout uses | `.bakers/connection.config.local.js` | Private, ignored by git |
| Project wiring and hooks | `.bakers/conductor.config.js` | Committed; local values in `.bakers/conductor.config.local.js` |
| Conductor log, temporary evidence | `.bakers/log.txt`, `assets-ai/` | Ignored by git, removed with the worktree |
| API keys | Created and revoked by each user on the server | The secret is shown once; a key acts as its owner |

### Who can read what on the server

Access follows workspace ranks and team membership: [Who sees what](/configuration/security#roles-and-permissions). Transcripts, when stored, are private files behind the same permissions.

### Keeping secrets out

Commit `WORKFLOW.md`, `.bakers/conductor.config.js` and the README entry; keep everything else above private. Credentials never belong in a ticket, a comment or the README. `git check-ignore` on the private paths is part of [connecting a project by hand](/get-started/connect-a-project).


