# keytec bakers-ddev Coder template

keytec's bakers.build worker box: one long-lived Coder workspace that comes up signed in and working on its first start. The [image](../../images/bakers-ddev/) carries every tool at a pinned version; this template only configures. Forked from bakers.build's [`coder/bakers-ddev`](https://github.com/bakers-build/bakers-build/blob/next/coder/bakers-ddev) ([MOVE.md](../../../MOVE.md) names the revision).

A workspace is one Sysbox container with its own Docker daemon, a home volume and a Docker volume. On every start the agent runs [`scripts/install.sh`](scripts/install.sh), which installs nothing:

1. [Git](#git): `gh` and `glab` sign in with the service-account tokens; commit identity.
2. [bakers.build sign-in](#bakersbuild-sign-in), once, with the box's OAuth client.
3. [Projects](#projects): clones the missing ones into `~/projects`.
4. [Previews](#previews): `frpc` from the FRP enrollment.
5. [Machine config](#machine-config): the Claude, Codex and ports entries in `~/.bakers/machine.config.js`.
6. `herdr server`, the [PM bot](#pm-bot), the [conductors](#conductor-autostart) and the [health](#health) loop.

Every step logs to `/tmp/coder-startup-script.log` and never fails the start.

## Tools

From the image, under `/usr/local`: `bakers`, `herdr`, `claude`, `codex`, `cursor-agent`, `gh`, `glab`, `cloudflared`, `frpc`, `ss`, Playwright with Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`), Docker and DDEV. `/usr/local/bin` comes first on `PATH`, so copies an older home volume still holds in `~/.local/bin` or `~/.npm-global/bin` never win. Nothing updates on start (`DISABLE_AUTOUPDATER=1`); a version bump is a new image ([image README](../../images/bakers-ddev/README.md)).

Claude Code reads `/etc/claude-code/managed-settings.json` from the image: the keytec marketplace and the enabled plugins. It fetches the plugins itself, through the GitLab credential helper. Codex gets the image's `config.toml` when `~/.codex/config.toml` is missing.

## Prerequisites

- A Coder deployment with a Docker host on amd64 that has the [Sysbox](https://github.com/nestybox/sysbox) runtime (`sysbox-runc`) and pull access to `git.key-tec.de:5050`.
- The image built and pushed ([image README](../../images/bakers-ddev/README.md)).

## Variables

Set them at push time with `--variable name=value`. A push needs only the two digests; there are no tool version variables.

| Variable | Default | Purpose |
|---|---|---|
| `image` | required | The image by digest, `git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:<tag>@sha256:<digest>`. Anything without `@sha256:` fails validation |
| `pm_bot_image` | empty | The PM bot's image by digest ([PM bot › The bot's version](#4-the-bots-version)). Anything without `@sha256:` fails validation. Empty: no workspace runs the bot |
| `pm_bot_registry_user`, `pm_bot_registry_token` | empty | Credentials for a private `pm_bot_image` registry; empty for the public GHCR image |
| `docker_host` | `unix:///var/run/docker.sock` | Docker socket of the Coder server |
| `cpu` | 4 | Relative CPU weight (cores x 1024), 1 to 32 |
| `memory` | 8 | Memory limit in GB, 2 to 128 |
| `disk_size` | 50 | Shown in the workspace metadata only |

## Push

```sh
coder templates push bakers-ddev -d coder/templates/bakers-ddev \
  --variable image=git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:<tag>@sha256:<digest> \
  --variable pm_bot_image=ghcr.io/bakers-build/bakers-build/pm-bot:<tag>@sha256:<digest>
```

The image's digest is in the CI job's `digest.txt` artifact and its last log line. Restrict the template in the Coder UI if needed.

## keytec defaults

Not secret, so they live in the template rather than in parameters: the bakers.build instance `https://app.bakers.build` and the GitLab host `git.key-tec.de` (`locals` in `template.tf`), the commit identity defaults, and the FRP zone that comes with the enrollment.

## Git

| Parameter | Value |
|---|---|
| `github_token` | The GitHub service account's access token (`repo`), masked. Empty: no GitHub sign-in |
| `gitlab_token` | The `git.key-tec.de` service account's access token (`api`, `write_repository`), masked. Empty: no GitLab sign-in |
| `git_user_name`, `git_user_email` | The commit identity; keytec defaults |

On every start [`scripts/git-setup.sh`](scripts/git-setup.sh) hands each token on stdin to `gh auth login` and `glab auth login`, then makes them git's credential helpers for `github.com` (`gh auth setup-git`) and `git.key-tec.de` (`glab auth git-credential`). The tokens live only in the CLIs' own stores in the home volume (`~/.config/gh`, `~/.config/glab-cli`); they reach no argument list or log. Log lines: `git: <host> signed in`, `skipped (no token)` or `sign-in failed`.

The PM bot keeps its own read-only `pm_bot_repo_*` parameters.

## bakers.build sign-in

| Parameter | Value |
|---|---|
| `bakers_client_id` | Client ID of the box's bakers.build consumer (client credentials) |
| `bakers_client_secret` | Its secret, masked |

When `~/.bakers/bakers.config.js` is missing, [`scripts/bakers-setup.sh`](scripts/bakers-setup.sh) runs `bakers init --auth-type client_credentials --secret-env …` against keytec's instance with the workspace name as label, then `bakers auth login`. `bakers init` stores the secret in `~/.bakers/bakers.config.js` (mode 0600) and writes the machine identity. A box that already has a connection is left alone. To switch clients, delete that file and restart. If the sign-in fails, the log says `bakers: sign-in failed`; run `bakers init` by hand.

## Projects

`projects` takes HTTPS repository URLs, separated by spaces, commas or new lines. Each start clones a missing one into `~/projects/<repo-name>` with the service accounts' credentials, before the conductors start. An existing checkout is never pulled or reset. Log lines: `projects: cloned`, `kept`, `failed <url>` or `skipped <url> (not an https:// URL)`.

## Previews

`frp_enrollment` takes the box's FRP enrollment string, `bkfrp1.<base64url JSON {server, port, zone, user, token}>` (masked). With it set, each start:

- writes `~/.config/frp/frpc.json` (0600) in the shape [`@bakers-build/addon-ports-frp`](https://github.com/bakers-build/bakers-build/blob/next/bakers-cli/addons/ports-frp/README.md) accepts: the server and token from the enrollment, the loopback admin API on port 7400 with a password generated once into `~/.config/frp/admin-password` (0600), server TLS verified against the system CA bundle, and `~/.bakers/frp/routes.json` as its only include;
- starts `frpc` (`/tmp/frpc.log`);
- has the [machine config](#machine-config) add the ports entry and `tunnel: true`, so runs get `BB_TUNNEL=1` and `bakers ports up web` returns an FRP URL.

A malformed string writes nothing and logs `frp: enrollment malformed`. Empty: no previews. The frps certificate must verify against the system CA bundle.

## Machine config

[`scripts/machine-config.mjs`](scripts/machine-config.mjs) owns these entries of `~/.bakers/machine.config.js` and marks each line with `// bakers-ddev keytec`: the `@bakers-build/addon-claude` and `@bakers-build/addon-codex` addons, and with FRP the `@bakers-build/addon-ports` entry over frp and `tunnel: true`. Every other line stays; an entry or `tunnel` key you wrote yourself wins. A missing file is created with a new `machine_id` and the workspace name as label (mode 0600). A file that does not load, or whose `addons` list is not written as `addons: [` on its own line, stays untouched and the log names what to add by hand. Cursor is installed but not registered as an agent.

## Health

The workspace page in the Coder dashboard shows three items besides `coder stat`, from [`scripts/health.sh`](scripts/health.sh):

| Item | Shows | Refresh |
|---|---|---|
| PM bot | `up (restarts: N)`, or `down (<state>, restarts: N)` for a stopped, exited or restarting container, `down (no container)` | 10 s |
| PM bot poller | `up (last pass Ns ago)`, `down` once its state file is older than 60 s (it passes every 15 s) | 10 s |
| Conductor | `<checkout> <status>` per conductor checkout, from a snapshot a background loop takes every 30 s with `bakers oven status`; `unknown` when the snapshot is older than 90 s | 30 s |

## Logs

`/tmp/coder-startup-script.log` holds the start's lines. `/tmp/bakers-conductors.log` holds the conductor autostart's retries, `/tmp/herdr-server.log` and `/tmp/frpc.log` the services' output, `/tmp/bakers-health/conductor` the conductor snapshot. `/tmp` lives for one start.

## Conductor autostart

**Start conductors on workspace start** (`conductor_autostart`) is on by default: every start runs `bakers oven start` in each `~/projects/*` checkout that has `.bakers/conductor.config.js` ([`scripts/conductors.sh`](scripts/conductors.sh)). The startup log has one line per checkout: `conductors: started <path>`, `failed <path>: <reason>`, or `waiting <path>: <reason>` when the conductor of the previous start still counts as live; that one is retried every 30 seconds for up to 12 minutes (`/tmp/bakers-conductors.log`).

## Tests

```sh
bash tests/run.sh            # every tests/*.test.sh: bash, git and node; template.test.sh also terraform or Docker
bash tests/run.sh git-setup  # one
```

The tests run the scripts with fake `gh`, `glab`, `bakers`, `git`, `docker` and `frpc` and a temporary home. `template.test.sh` runs `terraform validate` and [`tests/template.tftest.hcl`](tests/template.tftest.hcl) with mocked providers.

## PM bot

For the Hermes requester experience, return to [Use your client](https://bakers.build/get-started/use-your-client#hermes). This section owns operator setup.

The workspace can run the bakers.build PM bot ([`experimental/pm-bot/`](https://github.com/bakers-build/bakers-build/blob/next/experimental/pm-bot/README.md)): a Hermes gateway that answers in Slack, in a public channel it opens for each request, and a poller that posts ticket changes into those channels. Its settings are workspace parameters. Set them once; every start, restart, rebuild and template update brings the bot back with them. A workspace with every PM bot parameter empty runs no bot and starts as before.

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

   The **background** also sets the bot's language. The bot posts German unless the background names another language, in any wording, e.g. *Antworte auf Englisch.* or *Language: English*. The model's answers follow any language; the plugin's own texts exist in German and English and stay German for other languages. The poller's texts stay English for now. The bot reads the language when it starts: after a change, run `docker compose -p pm-bot restart` in the workspace; no rebuild is needed.
3. On that account, create an API key. It goes into `pm_bot_bakers_api_key`; the bot sends it as the bearer on `/mcp`. The site must accept an API key as bearer and offer the project ticket list tool, `bakers_user_read` and `labels_remove` on `bakers_ticket_update`.
4. Note the project's UUID for `pm_bot_project`. To have new tickets qualified at once, also note a conductor's UUID for `pm_bot_conductor`.

### 2. The Slack app

At api.slack.com/apps, choose **Create New App → From a manifest**, pick your workspace and paste [`experimental/pm-bot/slack-app-manifest.yaml`](https://github.com/bakers-build/bakers-build/blob/next/experimental/pm-bot/slack-app-manifest.yaml) from the bakers.build revision of the image. It sets up Socket Mode, the bot scopes and the message events. Its `channels:manage` scope lets the bot create, invite to, rename and archive the public request channels it opens; an app installed from an older manifest lacks it: add the scope under **OAuth & Permissions** and reinstall the app.

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
| `pm_bot_bakers_url` | no | The bakers.build server; keytec's (`https://app.bakers.build`) by default |
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
coder templates push bakers-ddev -d coder/templates/bakers-ddev \
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
