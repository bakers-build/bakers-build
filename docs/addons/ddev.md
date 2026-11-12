# DDEV

**Runs a project on DDEV: finds a worktree's DDEV services for Ports and gives agents tools for its DDEV project.**

DDEV is one runtime option for your project; bakers.build does not require it. The addon finds services and serves tools; it does not provision. Your repository's scripts prepare each ticket worktree through [lifecycle hooks](/provision/hooks), as in [Set up DDEV](/addons/ddev/setup).

## Enable it

For the agent tools, add it to the machine or project `addons`. For [Ports](/addons/ports), name it as a claimer in the ports entry:

```js
addons: [
  '@bakers-build/addon-ddev',
  {
    use: '@bakers-build/addon-ports',
    with: {
      transport: { use: '@bakers-build/addon-ports-cloudflare-quick' },
      claimers: ['@bakers-build/addon-ddev'],
    },
  },
],
```

Ports does not find DDEV services on its own. An installation that shared them before `claimers` existed must add this entry.

## Agent tools

The addon provides these tools for the run's worktree, the DDEV approot. Claude and Codex receive them through MCP; other harnesses can call them through `bakers tools` inside a run. See [Tools and integrations](/provision/tools).

| Tool | Does |
|---|---|
| `ddev_status()` | `ddev describe` as a summary: name, status, primary URL, services. |
| `ddev_start()` | `ddev start`, up to 10 minutes. |
| `ddev_exec(command)` | Runs `command` in the web container, up to 5 minutes. |

Answers carry the exit code and the last 64 KB of output; a non-zero exit is a tool error. The conductor's [`provision_up`](/provision/hooks#provision-on-an-agent-s-request) tool runs the DDEV script in [Set up DDEV](/addons/ddev/setup#provision-on-an-agent-s-request).

In `WORKFLOW.md`, a `ddev <cmd>` row runs as `ddev_exec("<cmd>")`:

```md
## bb-phase-provision

Drupal checks run on `provision_up('test')`. A `ddev <cmd>` row runs as `ddev_exec("<cmd>")`.

## bb-phase-validate

| When | Command |
|---|---|
| PHP implementation | `ddev phpcs && ddev phpstan` |
```

A sandboxed agent that calls `ddev` from its shell needs it among the trusted commands, for example `trusted_commands: ['$inherit', 'ddev']` in a [shared `permissions` block](/provision/security/shared-settings).

## Options

No options.

## Check it works

In a worktree with a running DDEV project, the ports list shows `web` and services such as `mailpit`.

::: details Per CLI
```sh
bakers ports list
```
:::

## Good to know

- The web container claims itself as `web`. Each configured and observed host alias adds a `web-<host>` key.
- Other services are named from DDEV daemon, service and Compose names. It reads containers through [Docker Compose discovery](/addons/docker-compose).
- DDEV keys never change; a process entry of [`services`](/addons/ports-services) reusing one becomes `<key>-<port>`.
- With [frp](/addons/ports-frp), DDEV services are proxied straight to the container IP. An unreachable IP, for example on Docker Desktop, fails that service; OrbStack works.
- It has no CMS-specific rules. A project that needs a particular `Host` header handles that itself.
- Linux only. It does not need root.
- A Coder workspace whose template ships Docker and DDEV.

Package source in a checkout: `bakers-cli/addons/ddev`.
