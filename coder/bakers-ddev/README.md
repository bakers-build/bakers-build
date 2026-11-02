# bakers-ddev Coder template

Coder is an optional client/workspace provider, separate from the [control-plane server](../../docs/configuration/project/server.md). A local workstation needs neither Coder nor preview tunnels.

One long-lived Coder workspace per person that is a bakers.build worker, like a developer's own machine. The template provides the machine and the tools. Signing in, checking out projects and starting conductors happen inside the workspace through `/bb-init`, which follows the [guide](../../docs/configuration/machine/coder-workspace.md).

A workspace is one Sysbox container with its own Docker daemon, a home volume, a Docker volume and the PM bot's volume. The agent runs [`scripts/install.sh`](scripts/install.sh) on every start. It installs each missing tool into the home volume, starts `herdr server`, then starts the [PM bot](#pm-bot) when the workspace has its parameters.

## Tools

`ss` (from Ubuntu's `iproute2`), `bakers`, `herdr`, `claude`, `codex`, `cursor-agent`, `gh` and `glab`. Docker and DDEV come from the image. `frpc` and `cloudflared` are installed and started only when their operator configuration files exist.

## Prerequisites

- A Coder deployment with a Docker host on amd64 that has the [Sysbox](https://github.com/nestybox/sysbox) runtime (`sysbox-runc`).
- A compatible public prebuilt workspace image that the Docker host can pull anonymously, without relying on a cached private image. No compatible public client release has yet been verified for this template; selecting an arbitrary public image does not satisfy its entrypoint/tool contract.

## Image requirements

The `image` variable names the full image reference, tag included. Any image works that provides:

- Ubuntu 24.04 with user `coder` (passwordless `sudo`).
- The entrypoint `/home/coder-files/bin/coder-entrypoint.sh`. It starts `dockerd`, opens its socket, makes `/home/coder` writable for `coder` and runs the Coder agent init script, which it receives as its first argument.
- Docker, DDEV, `curl`, `jq`, `tar` and `xz`.
- Node 22 with `npm config prefix` set to `~/.npm-global`, and `node` and `npx` on a system path outside `/home/coder` (for the PM bot).
- `git` and `perl` (for the PM bot).
- `~/.local/bin` and `~/.npm-global/bin` on `PATH` in `~/.profile` and `~/.bashrc`.

The home volume starts empty. Docker copies `/home/coder` of the image into it on first mount.

## Variables

Set them at push time with `--variable name=value`. `image` is required; other inputs have defaults.

| Variable | Default | Purpose |
|---|---|---|
| `image` | required | Public prebuilt workspace image with a version tag or digest, meeting the requirements above |
| `docker_host` | `unix:///var/run/docker.sock` | Docker socket of the Coder server |
| `cpu` | 4 | Relative CPU weight (cores x 1024), 1 to 32. It is not a limit |
| `memory` | 8 | Memory limit in GB, 2 to 128. Two DDEV projects, the Docker daemon and the agent CLIs can exceed 8 GB: raise it for heavier use |
| `disk_size` | 50 | Shown in the workspace metadata only: Docker volumes carry no quota |
| `bakers_version` | 0.3.0 | `@bakers-build/bakers` npm version |
| `herdr_version` | 0.9.5 | herdr release |
| `claude_version` | 2.1.306 | Claude Code release |
| `codex_version` | 0.163.0 | `@openai/codex` npm version |
| `cursor_version` | 2026.10.19-6bbf2c4 | Cursor CLI release |
| `gh_version` | 2.102.1 | GitHub CLI release |
| `glab_version` | 1.124.0 | GitLab CLI release |
| `cloudflared_version` | 2026.10.2 | cloudflared release |
| `frp_version` | 0.68.0 | frp release, the version the bakers.build frp transport is written against |
| `pm_bot_source_url` | `https://git.key-tec.de/bakers-build/bakers-build.git` | HTTPS URL the PM bot's code (`pm-bot/`) is fetched from, without credentials |
| `pm_bot_ref` | a bakers.build commit | Full 40-character commit hash whose `pm-bot/` every workspace runs. It also pins Hermes, through `pm-bot/bin/setup` |
| `pm_bot_source_user` | empty | User name of the deploy token for `pm_bot_source_url` |
| `pm_bot_source_token` | empty | Deploy token (`read_repository`) for `pm_bot_source_url`. Sensitive; empty for a public repository |

## Push

```sh
coder templates push bakers-ddev -d coder/bakers-ddev \
  --variable image=registry.example.org/team/workspace-base:1.0.0
```

Coder gives a new template to everyone by default. Restrict it in the Coder UI if needed. Create a workspace with `coder create <name> --template bakers-ddev`, then continue with the [guide](../../docs/configuration/machine/coder-workspace.md).

## Optional previews

Without provider configuration no tunnel client is downloaded or started. For FRP,
create `~/.config/frp/frpc.json` with your server and credentials. For named
Cloudflare, create `~/.cloudflared/tunnel-token`. Protect these files and restart
the workspace to install/start the selected client. For Cloudflare Quick, install
`cloudflared` explicitly before selecting that transport; it needs no token file.
The transport configuration must supply your own zone and endpoint; no company
preview zone is provided. Local development works without any of these providers.

## Updating versions

A tool that is already in the home volume is skipped, so a raised version variable reaches only workspaces where that tool is missing. To update one in an existing workspace, use the tool's own updater (`claude update`, `npm install -g @bakers-build/bakers@<version>`), or delete it (`rm "$(command -v <tool>)"`) and restart the workspace so the next start installs the pinned version. Claude Code updates itself in the background, so `claude_version` is the version of the first install only.

A start that fails to download a tool stops the install script, marks the start failed in Coder and starts no services on that start (`herdr server`, connectors). The next start retries.

## Logs

The install log is `/tmp/coder-startup-script.log`. The PM bot's gateway logs to `/tmp/hermes-gateway.log` and its poller to `/tmp/pm-bot-poller.log` ([PM bot › Logs](#logs-and-skip-lines)). `/tmp/herdr-server.log`, `/tmp/frpc.log` and `/tmp/cloudflared.log` hold the console output of `herdr server` and the connectors. `/tmp` lives for one start. herdr keeps its own log in `~/.config/herdr/herdr-server.log`.

## PM bot

The workspace can run the bakers.build PM bot (`pm-bot/` of bakers.build): a Hermes gateway that answers in Slack, and a poller that posts ticket changes into their Slack threads. Its settings are workspace parameters. Set them once; every start, restart and template update brings the bot back with them. A workspace with every PM bot parameter empty runs no bot and starts as before.

The bot runs as `pmbot`, a user with no `sudo`, no login shell and no Docker socket. On every bot start, `/home/coder` is set to mode `700`, so `pmbot` cannot read the owner's credentials, checkouts or worktrees. Its home is a separate volume, `/home/pmbot`, which keeps Hermes, its sessions and the clone of the project's repository.

### 1. The bot's service account

As a bakers.build workspace administrator:

1. **Workspace → Service accounts → Add**: an account for the bot, with a rank that may create and update tickets, in the team that sees the project.
2. On that account, create an API key. Its client ID and secret go into `pm_bot_bakers_client_id` and `pm_bot_bakers_client_secret`.
3. Note the project's UUID for `pm_bot_project`. To have new tickets qualified at once, also note a conductor's UUID for `pm_bot_conductor`.

### 2. The Slack app

At api.slack.com/apps, choose **Create New App → From a manifest**, pick your workspace and paste `pm-bot/slack-app-manifest.yaml` from bakers.build at the template's `pm_bot_ref`. It sets up Socket Mode, the bot scopes and the message events.

1. **Basic Information → App-Level Tokens:** generate a token with the `connections:write` scope. That is the app token (`xapp-…`) for `pm_bot_slack_app_token`.
2. **Install App → Install to Workspace.** The bot token (`xoxb-…`) goes into `pm_bot_slack_bot_token`.
3. Invite the bot to the project's channels (`/invite @<bot>`). Their channel IDs (channel name → **View channel details**, at the bottom) go into `pm_bot_slack_allowed_channels`.
4. Copy the operators' member IDs (profile → **⋮ → Copy member ID**) into `pm_bot_slack_admin_users`.
5. Optional: create a private channel with only the operators in it and invite the bot. That is Hermes' home channel for its restart notices (`pm_bot_slack_home_channel`).

### 3. Parameters

Set these in the workspace form, or with `--parameter` on `coder create` and `coder update`. A changed value takes effect on the next start, and `coder update` restarts the workspace.

| Parameter | Required | Value |
|---|---|---|
| `pm_bot_slack_bot_token` | yes | Bot token, `xoxb-…` (masked) |
| `pm_bot_slack_app_token` | yes | App token, `xapp-…` (masked) |
| `pm_bot_slack_allowed_channels` | yes | Channel IDs the bot answers in. Messages in any other channel are ignored |
| `pm_bot_slack_allowed_users` | no | Member IDs the bot answers. Empty: every user in the allowed channels. Set: only these users |
| `pm_bot_slack_admin_users` | yes | Operators' member IDs: the only users who may run Hermes slash commands |
| `pm_bot_slack_workspace_url` | yes | `https://<workspace>.slack.com`, for thread permalinks |
| `pm_bot_slack_home_channel` | no | Channel ID of the operators' channel |
| `pm_bot_bakers_url` | yes | The bakers.build server, `https://…` |
| `pm_bot_bakers_client_id` | yes | API key client ID |
| `pm_bot_bakers_client_secret` | yes | API key secret (masked) |
| `pm_bot_project` | yes | Project UUID |
| `pm_bot_ticket_workflow` | no | `bb_work` (default), or `bb_autopilot` for automatic approvals |
| `pm_bot_conductor` | no | Conductor UUID set on each new ticket |
| `pm_bot_anthropic_api_key` | one of two | Anthropic API key (masked). Use it for a shared bot |
| `pm_bot_claude_oauth_token` | one of two | Token from `claude setup-token`, for tests (masked). Set exactly one of the two |
| `pm_bot_model` | no | Default `claude-sonnet-5-5` |
| `pm_bot_repo_url` | no | HTTPS URL of the project's repository, without credentials. The bot reads a secret-free clone of it. Empty: no code access |
| `pm_bot_repo_user`, `pm_bot_repo_token` | no | A read-only token (`read_repository`) for that URL; the token is masked. It is used only while cloning and is never written to the bot's configuration |

Channel and member IDs are separated by spaces, commas or both. On the command line, quote the list and separate it with spaces:

```sh
coder create pm --template bakers-ddev \
  --parameter pm_bot_slack_bot_token=xoxb-… \
  --parameter pm_bot_slack_app_token=xapp-… \
  --parameter "pm_bot_slack_allowed_channels=C0123456789 C0987654321" \
  --parameter pm_bot_slack_admin_users=U0123456789 \
  --parameter pm_bot_slack_workspace_url=https://example.slack.com \
  --parameter pm_bot_bakers_url=https://bakers.example.com \
  --parameter pm_bot_bakers_client_id=… \
  --parameter pm_bot_bakers_client_secret=… \
  --parameter pm_bot_project=00000000-0000-4000-8000-000000000000 \
  --parameter pm_bot_anthropic_api_key=sk-ant-…

coder update pm --parameter "pm_bot_slack_allowed_users=U0123456789 U0987654321"
```

### 4. Changing the bot's version

The template variable `pm_bot_ref` decides which bot runs, and with it which Hermes version runs. To move every workspace to a new revision, push the template with the new hash (`--variable pm_bot_ref=<40-character hash>`) and update or restart each workspace. The script fetches only `pm-bot/` at that commit into `/opt/pm-bot`, owned by root, and installs Hermes for `pmbot` when its version differs from the pin. The repository is private, so set a deploy token with `pm_bot_source_user` and `pm_bot_source_token`. git receives the token only through its environment.

### Logs and skip lines

The script logs to `/tmp/coder-startup-script.log` and never fails the workspace start. Whatever stops the bot writes one line there and to `/tmp/hermes-gateway.log`:

| Line | Meaning |
|---|---|
| `pm-bot: skipped: no bot configured` | Every PM bot parameter is empty |
| `pm-bot: skipped: missing parameters: pm_bot_…` | These required parameters, or the template variables marked as such, are empty |
| `pm-bot: skipped: set exactly one of …` | Neither or both model credentials are set |
| `pm-bot: skipped: pm_bot_… must …` | A value has the wrong form: a UUID, a Slack ID list or a URL |
| `pm-bot: skipped: fetching pm-bot/ at … failed` | The pin, the source URL or the deploy token is wrong |
| `pm-bot: skipped: refreshing the clone of … failed` | The repository URL or its token is wrong |
| `pm-bot: skipped: bin/setup failed` | The bot rejected its configuration; the reason is in the startup log |

After a successful start, `/tmp/coder-startup-script.log` has `pm-bot: code at <ref>`. The gateway logs to `/tmp/hermes-gateway.log` and the poller to `/tmp/pm-bot-poller.log`. To check the processes, run `ps -o user,pid,args -u pmbot`.
