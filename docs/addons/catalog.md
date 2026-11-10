# Available addons

<span id="addons"></span>

Choose an integration for your task, then follow its setup guide. [Configure addons](/addons/configure) explains file ownership and activation.

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

[Use your client](/get-started/use-your-client) compares the experiences; these addons supply their technical integration.

| Addon | What it adds |
|---|---|
| [herdr](/addons/herdr) | Runs agents in herdr-cli sessions and worktrees |
| [herdr-core](/addons/herdr-core) | Hosts herdr-app's agent terminals independently of the app |
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

The [DDEV addon](/addons/ddev) and [Compose discovery](/addons/docker-compose) find ports; they do not provision environments. Use [project hooks](/provision/guide) for your project's runtime. Native Node is not an addon.

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
| [HTTP Basic sign-in](/addons/auth-basic) | Fixed Basic auth token |

Generated connection support needs no separate selection; see [connection defaults](/addons/configure#connection-defaults).

[Configure addons](/addons/configure) · [Build your own](/addons/build/first-addon)
