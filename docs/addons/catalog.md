# Available addons

<span id="addons"></span>

Choose an integration for your task, then follow its setup guide. [Configure addons](/addons/configure) explains file ownership and activation.

## Agents

| Addon | What it adds |
|---|---|
| [Claude](/addons/claude) | Claude Code harness |
| [Codex](/addons/codex) | Codex CLI harness |
| [Grok](/addons/grok) | Grok Build harness |
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

## Sharing previews and ports

| Addon | What it adds |
|---|---|
| [Ports](/addons/ports) | Share a running service publicly |
| [Named Cloudflare tunnel](/addons/ports-cloudflare) | Fixed names in your Cloudflare zone |
| [Cloudflare Quick tunnel](/addons/ports-cloudflare-quick) | Random URL, no account |
| [frp tunnel](/addons/ports-frp) | Fixed names through your frp server |

## Delivery

| Addon | What it adds |
|---|---|
| [Forge](/addons/forge) | Fetch, push, PR/MR, checks and merge as conductor tools; the token stays with the conductor |
| [Forge for GitHub](/addons/forge-github) | GitHub App installation token for one repository, or your `gh` login |
| [Forge for GitLab](/addons/forge-gitlab) | GitLab Project Access Token, or your `glab` login |


## Provisioning support

The [DDEV addon](/addons/ddev) and [Compose discovery](/addons/docker-compose) find ports; they do not provision environments. Use [project hooks](/provision/guide) for your project's runtime. Native Node is not an addon.

## Terminal UI

| Addon | What it adds |
|---|---|
| [Terminal UI](/addons/bakers-ui) | The `bakers ui` renderer |

## Time

| Addon | What it adds |
|---|---|
| [Time evidence](/addons/track) | Daily evidence for time entries |

## Commands

| Addon | What it adds |
|---|---|
| [Agent catalog](/addons/agents) | Lists agent aliases and routes |
| [Deployment tickets](/addons/deployment) | Tickets in a release range |

## Machine connections

| Addon | What it adds |
|---|---|
| [Tailscale](/addons/tailscale) | Detects a private SSH address once at conductor start |

[Configure addons](/addons/configure) · [Build your own](/addons/build/first-addon)
