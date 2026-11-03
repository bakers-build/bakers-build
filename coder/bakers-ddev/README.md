# bakers-ddev Coder template

Coder is an optional client/workspace provider, separate from the [control-plane server](../../docs/configuration/project/server.md). A local workstation needs neither Coder nor preview tunnels.

One long-lived Coder workspace per person that is a bakers.build worker, like a developer's own machine. The template provides the machine and the tools. Signing in, checking out projects and starting conductors happen inside the workspace through `/bb-init`, which follows the [guide](../../docs/configuration/machine/coder-workspace.md).

A workspace is one Sysbox container with its own Docker daemon, a home volume and a Docker volume. The agent runs [`scripts/install.sh`](scripts/install.sh) on every start. It installs each missing tool into the home volume, then starts `herdr server`.

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
- Node 22 with `npm config prefix` set to `~/.npm-global`.
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

The install log is `/tmp/coder-startup-script.log`. `/tmp/herdr-server.log`, `/tmp/frpc.log` and `/tmp/cloudflared.log` hold the console output of `herdr server` and the connectors. `/tmp` lives for one start. herdr keeps its own log in `~/.config/herdr/herdr-server.log`.
