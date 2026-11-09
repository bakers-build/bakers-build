# bakers-ddev Coder template

Coder provides an optional worker environment, separate from the [control-plane server](../../docs/self-hosting/server.md). [Use your client](https://bakers.build/get-started/use-your-client) compares the four user-facing clients. A local workstation needs neither Coder nor preview tunnels.

One long-lived Coder workspace per person that is a bakers.build worker, like a developer's own machine. The template provides the machine and the tools. Signing in, checking out projects and starting conductors happen inside the workspace through `/bb-init`, which follows the [guide](../../docs/provision/coder-workspace.md).

A workspace is one Sysbox container with its own Docker daemon, a home volume and a Docker volume. The agent runs [`scripts/install.sh`](scripts/install.sh) on every start. It installs each missing tool into the home volume, starts `herdr server`, then starts the [PM bot](#pm-bot) when the workspace has its parameters.

## Tools

`ss` (from Ubuntu's `iproute2`), `bakers`, `herdr`, `claude`, `codex`, `cursor-agent`, `gh` and `glab`. Docker and DDEV come from the image. `frpc` and `cloudflared` are installed and started only when their operator configuration files exist. With PM bot parameters, the bot runs as a container on the workspace's Docker daemon.

## Prerequisites

- A Coder deployment with a Docker host on amd64 that has the [Sysbox](https://github.com/nestybox/sysbox) runtime (`sysbox-runc`).
- A compatible public prebuilt workspace image that the Docker host can pull anonymously, without relying on a cached private image. No compatible public client release has yet been verified for this template; selecting an arbitrary public image does not satisfy its entrypoint/tool contract.

## Image requirements

The `image` variable names the full image reference, tag included. Any image works that provides:

- Ubuntu 24.04 with user `coder` (passwordless `sudo`).
- The entrypoint `/home/coder-files/bin/coder-entrypoint.sh`. It starts `dockerd`, opens its socket, makes `/home/coder` writable for `coder` and runs the Coder agent init script, which it receives as its first argument.
- Docker, DDEV, `curl`, `jq`, `tar` and `xz`.
- Node 22 with `npm config prefix` set to `~/.npm-global`.
- `git` and Docker Compose v2 (for the PM bot).
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
| `pm_bot_image` | empty | The PM bot's image with tag and digest, `<registry>/<path>:<tag>@sha256:<digest>` ([PM bot › The bot's version](#4-the-bots-version)). Empty: no workspace runs the bot |
| `pm_bot_registry_user` | empty | User name for `pm_bot_image`'s registry. Empty for the public GHCR image |
| `pm_bot_registry_token` | empty | Token for that registry, for example a GitHub token with `read:packages` for a private package. Sensitive; empty for the public GHCR image |

## Push

```sh
coder templates push bakers-ddev -d coder/bakers-ddev \
  --variable image=registry.example.org/team/workspace-base:1.0.0
```

Coder gives a new template to everyone by default. Restrict it in the Coder UI if needed. Create a workspace with `coder create <name> --template bakers-ddev`, then continue with the [guide](../../docs/provision/coder-workspace.md).

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

The install log is `/tmp/coder-startup-script.log`. The PM bot logs to its container ([PM bot › Logs](#logs-and-skip-lines)). `/tmp/herdr-server.log`, `/tmp/frpc.log` and `/tmp/cloudflared.log` hold the console output of `herdr server` and the connectors. `/tmp` lives for one start. herdr keeps its own log in `~/.config/herdr/herdr-server.log`.

## PM bot

For the Hermes requester experience, return to [Use your client](https://bakers.build/get-started/use-your-client#hermes). This section owns operator setup.

The workspace can run the bakers.build PM bot ([`experimental/pm-bot/`](../../experimental/pm-bot/README.md)): a Hermes gateway that answers in Slack, in a public channel it opens for each request, and a poller that posts ticket changes into those channels. Its settings are workspace parameters. Set them once; every start, restart, rebuild and template update brings the bot back with them. A workspace with every PM bot parameter empty runs no bot and starts as before.

The bot is one container, `pm-bot`, on the workspace's own Docker daemon, from the image the template variable `pm_bot_image` pins. On every start, [`scripts/pm-bot.sh`](scripts/pm-bot.sh) checks the parameters, writes the bot's env file, refreshes the clone of the project's repository and runs `docker compose up` with [`pm-bot.compose.yaml`](pm-bot.compose.yaml). The container restarts on its own (`unless-stopped`) and sees two directories of the home volume, nothing else:

| Host path | In the container | Holds |
|---|---|---|
| `~/.pm-bot/data` | `/opt/data`, read-write | Hermes' home: sessions, memories, learned skills, the poller's state, the list of request channels the bot opened and the env file. Kept across starts and rebuilds |
| `~/.pm-bot/clone` | `/opt/clone`, read-only | A clone of the project's repository without env files, settings, keys and certificates |

It has no Docker socket and every capability dropped except the four Hermes' start needs to drop to its own user, which runs as the workspace user's UID. Every start rewrites the env file from the parameters, and the container rewrites `config.yaml`, `SOUL.md`, the shipped skills (`bb-create-ticket`, its recipes and their method skills) and the `bot-channels` plugin from the image and removes the retired `project-manager` skill: edits to them are lost; sessions, memories and learned skills stay.

### 1. The bot's service account

As a bakers.build workspace administrator:

1. **Workspace → Service accounts → Add**: an account for the bot, with a rank that may create and update tickets, as a member of the bot's project's team only. The bot reaches bakers.build only through its tools on `/mcp`, with this account's rights, so the membership is its reach.
2. On that account's profile, set its **position** and **background**: `bb-create-ticket` reads its own user first and works the way they say. For example, position *Project manager*, background *Specifies every idea with its requester before work starts and answers technical questions itself.*
3. On that account, create an API key. It goes into `pm_bot_bakers_api_key`; the bot sends it as the bearer on `/mcp`. The site must accept an API key as bearer and offer the project ticket list tool, `bakers_user_read` and `labels_remove` on `bakers_ticket_update`.
4. Note the project's UUID for `pm_bot_project`. To have new tickets qualified at once, also note a conductor's UUID for `pm_bot_conductor`.

### 2. The Slack app

At api.slack.com/apps, choose **Create New App → From a manifest**, pick your workspace and paste [`experimental/pm-bot/slack-app-manifest.yaml`](../../experimental/pm-bot/slack-app-manifest.yaml) from the bakers.build revision of the image. It sets up Socket Mode, the bot scopes and the message events. Its `channels:manage` scope lets the bot create, invite to, rename and archive the public request channels it opens; an app installed from an older manifest lacks it: add the scope under **OAuth & Permissions** and reinstall the app.

1. **Basic Information → App-Level Tokens:** generate a token with the `connections:write` scope. That is the app token (`xapp-…`) for `pm_bot_slack_app_token`.
2. **Install App → Install to Workspace.** The bot token (`xoxb-…`) goes into `pm_bot_slack_bot_token`.
3. Invite the bot to the project's channel (`/invite @<bot>`). Its channel ID (channel name → **View channel details**, at the bottom) goes into `pm_bot_slack_allowed_channels`. That is the bot's main channel: a mention there opens a request channel. The bot has exactly one; with more than one ID the container refuses to start.
4. Copy the operators' member IDs (profile → **⋮ → Copy member ID**) into `pm_bot_slack_admin_users`.
5. Optional: create a private channel with only the operators in it and invite the bot. Set it as Hermes' home channel for its restart notices (`pm_bot_slack_home_channel`); without one, the home channel is the allowed channel.

### 3. Parameters

Set these in the workspace form, or with `--parameter` on `coder create` and `coder update`. A changed value takes effect on the next start, and `coder update` restarts the workspace. Values may hold letters, digits and `. _ ~ : / , @ + = % -` only; the API key may hold any character but spaces and line breaks.

| Parameter | Required | Value |
|---|---|---|
| `pm_bot_slack_bot_token` | yes | Bot token, `xoxb-…` (masked) |
| `pm_bot_slack_app_token` | yes | App token, `xapp-…` (masked) |
| `pm_bot_slack_allowed_channels` | yes | The bot's main channel ID, where a mention opens a request channel. Besides it the bot answers only in the request channels it opened; messages in any other channel are ignored |
| `pm_bot_slack_allowed_users` | no | Member IDs the bot answers. Empty: every user in its channels. Set: only these users |
| `pm_bot_slack_admin_users` | yes | Operators' member IDs: the only users who may run Hermes slash commands |
| `pm_bot_slack_workspace_url` | yes | `https://<workspace>.slack.com`, for channel links |
| `pm_bot_slack_home_channel` | no | Channel ID of the operators' channel; empty means the first allowed channel |
| `pm_bot_bakers_url` | yes | The bakers.build server, `https://…` |
| `pm_bot_bakers_api_key` | yes | The service account's API key (masked) |
| `pm_bot_project` | yes | Project UUID |
| `pm_bot_ticket_workflow` | no | Workflow of the tickets the bot creates, default `bb_work` |
| `pm_bot_conductor` | no | Conductor UUID set on each new ticket |
| `pm_bot_anthropic_api_key` | one of two | Anthropic API key (masked). Use it for a shared bot |
| `pm_bot_claude_oauth_token` | one of two | Token from `claude setup-token`, for tests (masked). Set exactly one of the two |
| `pm_bot_model` | no | Default `claude-sonnet-5-5` |
| `pm_bot_repo_url` | no | HTTPS URL of the project's repository, without credentials. The bot reads a secret-free clone of it. Empty: no code access |
| `pm_bot_repo_user`, `pm_bot_repo_token` | no | A read-only token (`read_repository`) for that URL; the token is masked. Only git uses it, while cloning on the workspace; it never reaches the container |

Channel and member IDs are separated by spaces, commas or both. On the command line, quote the list and separate it with spaces:

```sh
coder create pm --template bakers-ddev \
  --parameter pm_bot_slack_bot_token=xoxb-… \
  --parameter pm_bot_slack_app_token=xapp-… \
  --parameter "pm_bot_slack_allowed_channels=C0123456789" \
  --parameter pm_bot_slack_admin_users=U0123456789 \
  --parameter pm_bot_slack_workspace_url=https://example.slack.com \
  --parameter pm_bot_bakers_url=https://bakers.example.com \
  --parameter pm_bot_bakers_api_key=… \
  --parameter pm_bot_project=00000000-0000-4000-8000-000000000000 \
  --parameter pm_bot_anthropic_api_key=sk-ant-…

coder update pm --parameter "pm_bot_slack_allowed_users=U0123456789 U0987654321"
```

On the command line, use the space form shown above: a `--parameter` value with commas may be split by the CLI. The form field accepts both.

### 4. The bot's version

The bot's image is `experimental/pm-bot/Dockerfile`: the official Hermes image at the version the bot is written for, with the bot's files baked in. GitHub CI builds and checks it in `image_gate` with the other images, and the release publishes it as a public package beside them: `ghcr.io/bakers-build/bakers-build/pm-bot`, tagged with the commit and the branch (`next`, `main`), and on `main` also with the version and `latest`. Pin a tag with its digest:

```sh
docker buildx imagetools inspect ghcr.io/bakers-build/bakers-build/pm-bot:<tag> --format '{{.Manifest.Digest}}'
```

```text
pm_bot_image=ghcr.io/bakers-build/bakers-build/pm-bot:<tag>@sha256:<digest>
```

Push the template with it, then update or restart each workspace. The package is public, so the registry variables stay empty:

```sh
coder templates push bakers-ddev -d coder/bakers-ddev \
  --variable pm_bot_image=ghcr.io/bakers-build/bakers-build/pm-bot:<tag>@sha256:<digest>
```

The script refuses an image without its digest. For an image in a private registry, also set `pm_bot_registry_user` and `pm_bot_registry_token`. The script logs in with the token on `docker login`'s stdin, so the token stays in the workspace user's Docker configuration (`~/.docker/config.json`) and never reaches the bot's env file or container.

### Logs and skip lines

The script logs to `/tmp/coder-startup-script.log` and never fails the workspace start. Whatever stops the bot takes the container down and writes one line there:

| Line | Meaning |
|---|---|
| `pm-bot: skipped: no bot configured` | Every PM bot parameter is empty |
| `pm-bot: skipped: missing parameters: pm_bot_…` | These required parameters, or the template variable marked as such, are empty |
| `pm-bot: skipped: set exactly one of …` | Neither or both model credentials are set |
| `pm-bot: skipped: pm_bot_… must …` | A value has the wrong form: a UUID, a Slack ID list, a URL or the image pin |
| `pm-bot: skipped: refreshing the clone of … failed` | The repository URL or its token is wrong |
| `pm-bot: skipped: secret files in the clone …` | A file named like a secret is in the clone; remove it |
| `pm-bot: skipped: docker login to … failed` | The registry token is wrong or expired |
| `pm-bot: skipped: docker compose up failed` | The image could not be pulled or started; the reason is in the lines above |

After a successful start the log has `pm-bot: running <image>`. The container's own log holds the gateway's and the poller's output:

```sh
docker compose -p pm-bot ps      # one service, running
docker compose -p pm-bot logs -f
```

The container exits when the gateway or the poller exits, with `pm-bot: missing: …` when a required key is not in its env file, and Docker restarts it. Hermes' own logs are in `~/.pm-bot/data/logs`.
