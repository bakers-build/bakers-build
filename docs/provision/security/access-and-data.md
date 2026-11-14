# Access and data

<span id="security"></span>

Account authorization determines which server resources a person or service can access. [Agent permissions and isolation](/agents/security) determine how work runs on a machine. Configure these independently; a workspace rank does not confine a process, and a sandbox does not change an account’s server rights.

## Credentials and access

Authorize chat connectors with your own account. [API keys and service accounts](/provision/security/credentials) explains issuing, revoking and limiting credentials. Keep connection files under `~/.bakers` private; sign-in tokens live in dropsh's per-host `~/.config/dropsh/` store. [Connections](/configuration/connection) owns the authentication profiles and file permissions.

Never put credentials in tickets, README files or committed project configuration. Ignore `.bakers/connection.config.js`, `.bakers/log.txt` and `assets-ai/`; verify with `git check-ignore` during [project setup](/get-started/connect-a-project).

## Roles and permissions

**Your rights come from your rank in the workspace. Your teams decide which projects you see.**

### Workspace ranks

| Rank | You can |
|---|---|
| **Admin** | Everything in the workspace: invite people, manage members, teams and settings, see every project, delete tickets. |
| **Contributor** | Work: create and edit tickets, assign, freeze and cancel them, create projects, register your own conductor, record your own time. |
| **Guest** | Read tickets, comments, projects and teams. Change nothing. |

The person who created the workspace owns it and holds the Admin rank; their rights come from that rank alone. Nobody can remove or demote the owner or the last Admin. Creating or deleting a workspace itself is reserved for the instance administrator.

### Teams

A team makes its projects visible to its members. You see **every ticket of every project you can see**; tickets are never filtered by person.

| Team role | Adds |
|---|---|
| **Member** | Sees the team's projects. |
| **Lead** | Edits the team's projects and billing accounts, sees the team's statistics and the recorded hours of active members. |
| **Reporter** | Creates tickets in the team's projects, without general ticket-edit rights. |
| **Owner** | Manages team membership and edits its projects; this role does not itself grant the Lead's worklog/statistics access. |

### Common tasks

| You want to | You need |
|---|---|
| See a project and its tickets | Membership in one of its teams, or Admin |
| Create, assign, freeze or cancel a ticket | Contributor with project access; Reporter grants creation only |
| Review a ticket | Access to its project (a team seat or Admin), and to be listed under **Reviewers** on that ticket |
| Record your time | Contributor; only you can edit your entries |
| See a teammate's hours | Team Lead, for active members of your team |
| Manage billing accounts | Team Lead, Team Owner or Admin |
| Change a conductor or machine | To be its owner |
| Invite someone | Admin |

Another workspace is invisible to you, even its name. An API key you create acts as you, with your current rights, for at most a year.

Review, merge and deployment stay explicit human decisions, whatever your rank.

## Agent execution boundaries

Choose [agent permissions](/provision/security/execution) for allowed actions and [isolation](/agents/isolation) for process reach. Runs default to `system`; supported native sandbox mode must be selected explicitly. A worktree or application container alone is not an agent security boundary.

[Conductor tools](/provision/tools#work-across-permissions-and-isolation) let restricted agents request operations without receiving every underlying credential. Their account access, execution rights and returned data need their own policy. Host tools and project hooks remain outside the agent boundary; inspect any editable worktree files they execute. Treat ticket text as task input, not authority to widen access.

## Public previews and ports

Localhost previews are local by default. A public tunnel can expose the application to anyone with the URL while it runs; review authentication, sample data and secrets before sharing. Machine `tunnel: true` permits a single ad hoc preview; [Ports](/addons/ports) has separately configured transport policy. Stop tunnels when their purpose ends.

Isolate each worktree's service names, ports and data. Cleanup that deletes a worktree's database, without a snapshot, loses its data; export anything needed first. Native processes and Compose services also need scoped cleanup.

## Hosting and data

See [hosted or self-run](/self-hosting/choosing) for the server choice and [server operations](/self-hosting/server) for deployment and backups.

## Where your code and data live

**Your repository stays on the worker. Model requests, tool output, handoffs and optional transcripts can contain code; review each destination's access and retention.**

| What | Where | Notes |
|---|---|---|
| Your repository and worktrees | Your machine, `<checkout>/.bakers-worktrees/` by default with herdr, or the workspace backend's configured location | One git worktree per ticket; removed when the ticket is done or cancelled |
| Tickets, comments, states, labels | The bakers.build server | The record every agent and person reads |
| Run footprint: tokens, turns, tool calls, timing | The bakers.build server | Shown on each run; what the statistics count |
| Run transcripts | Your own server when self-run and opted in; nowhere on hosted bakers.build | Uploaded at the end of a run only when the server's [run-log storage](/self-hosting/server#run-log-storage) allows it for the workspace; see that reference for the current file-loader limitation |
| Agent sessions and model traffic | Between your machine and your model provider | provider keys stay on the worker; stored run transcripts may contain prompts and tool output |
| Connection, machine and project configuration | Worker files, with ownership defined in the [file map](/configuration/) | Keep secrets and local selectors private; machine capacity is stored on the server |
| Conductor log, temporary evidence | `.bakers/log.txt`, `assets-ai/` | Ignored by git, removed with the worktree |
| API keys | Created and revoked by each user on the server | The secret is shown once; a key acts as its owner |

### Who can read what on the server

Access follows workspace ranks and team membership: [Who sees what](/provision/security/access-and-data#roles-and-permissions). Transcripts, when stored, are private files behind the same permissions.

### Keeping secrets out

Follow [Credentials and access](#credentials-and-access) above. Check the ignored paths before committing; a secret in an ignored local file can still be read by a process with access to it.
