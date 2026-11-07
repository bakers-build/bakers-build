# Addons

Choose supported extensions by purpose.

## Agents

| Addon | What it adds |
|---|---|
| [Claude](/addons/claude) | Claude Code harness |
| [Codex](/addons/codex) | Codex CLI harness |
| [Grok](/addons/grok) | Grok Build harness |
| [Kimi](/addons/kimi) | Kimi Code harness |
| [OpenCode](/addons/opencode) | OpenCode harness |
| [Pi](/addons/pi) | pi harness |

## Clients and workspaces

| Addon | What it adds |
|---|---|
| [herdr](/addons/herdr) | Runs agents in herdr sessions and worktrees |
| [herdr-core](/addons/herdr-core) | Runs agents in herdr-core terminals that outlive the app |
| [Orca](/addons/orca) | Local worktree UI and agent terminals |
| [Git workspace](/addons/workspace-git) | Plain Git worktree per ticket |
| [bakers.build server remote](/addons/remote-drupal) | Connects a conductor to the server |

## Sharing previews and ports

| Addon | What it adds |
|---|---|
| [Ports](/addons/ports) | Share a running service publicly |
| [Named Cloudflare tunnel](/addons/ports-cloudflare) | Fixed names in your Cloudflare zone |
| [Cloudflare Quick tunnel](/addons/ports-cloudflare-quick) | Random URL, no account |
| [frp tunnel](/addons/ports-frp) | Fixed names through your frp server |


## Provisioning support

[DDEV discovery](/addons/ddev) and [Compose discovery](/addons/docker-compose) find ports; they do not provision environments. Use [project hooks](/configuration/provisioning) for DDEV, Compose or native Node. Native Node is not an addon.

## Terminal UI

| Addon | What it adds |
|---|---|
| [Terminal UI](/addons/bakers-ui) | The `bakers ui` renderer |
| [Artifacts](/addons/bakers-ui-artifacts) | Ticket tab with local run evidence |

## Time

| Addon | What it adds |
|---|---|
| [Time evidence](/addons/track) | Daily evidence for time entries |

## Commands

| Addon | What it adds |
|---|---|
| [Agent catalog](/addons/agents) | Lists agent aliases and routes |
| [Project info](/addons/info) | Current project and workspace as JSON |
| [Deployment tickets](/addons/deployment) | Tickets in a release range |

## Connection support

| Addon | What it adds |
|---|---|
| [Essentials](/addons/essentials) | Markdown, schema and name resolution |
| [Name references](/addons/name-refs) | Labels and environments by name |
| [Ambient workspace](/addons/workspace) | Fills in your workspace |
| [HTTP Basic sign-in](/addons/auth-basic) | Fixed Basic auth token |

[Fake conductor fixture](/addons/fake) is test-only.

[Configure addons](/addons/configure) · [Build your own](/addons/build/contracts)
