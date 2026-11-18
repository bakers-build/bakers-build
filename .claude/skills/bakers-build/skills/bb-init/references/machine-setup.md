# Machine setup

## Decision matrix

Load the linked documentation when its condition applies, then resolve only missing inputs under
the [setup conversation](setup-conversation.md) rules: one question per block. The documentation
owns configuration syntax and supported options; this matrix owns the setup flow, the evidence
that answers a row and the short recommendation given with each question. Client, application
environment and workflow are project blocks.

### Machine

| When | Decide | Writes | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|---|
| Host role unknown | Host role: whether this host runs tickets, and where: prepared environment, Coder workspace, remote server or this computer | No key; it decides where the setup continues: this computer, or a hand-off to the chosen host | An environment the team already prepared; otherwise this computer | Existing `machine.config.js`; the caller's request | The host role decides whether this machine's conductor takes tickets and where their agents run. | [Choose where agents run](https://bakers.build/provision/machine.md) |
| Host runs tickets | Agent harness to register | Harness entry in `addons` of `machine.config.js` | The agent already installed and signed in here | The agent this setup runs in; harness addons in `machine.config.js` | Its model credentials go to `~/.bakers/.bakers.env`: the conductor's private environment file beside `machine.config.js`, `chmod 600`, read at every conductor start and never committed. | [Agents](https://bakers.build/agents/index.md), [machine agents](https://bakers.build/configuration/machine.md#agents) |
| Several agents, or states need different agents | Default agent, then routes | `agents.routes` in `machine.config.js` | One agent; routes only when states need different agents | `agents` in `machine.config.js` | `agents.routes` maps workflow states (or `'*'`) to agent aliases; `agents.routes.default['*']` is the default agent. | [Which agent runs a state](https://bakers.build/configuration/machine.md#which-agent-runs-a-state) |
| Machine identity missing | Label | `label` in `machine.config.js` | — | — | — | [Machine](https://bakers.build/configuration/machine.md) |

### Permissions

Both rows are own decisions.

| When | Decide | Writes | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|---|
| Host runs tickets | Permission mode for every agent on this host | `permissions.mode` in `machine.config.js`; for a sandbox runtime, `runtime` (`{ use: '@bakers-build/addon-runtime-bwrap' }` or `-docker`) | `system` when the host runs only the person's own tickets or works in a trusted environment; otherwise `sandbox` with a runtime, offering only those whose prerequisites pass: `runtime-bwrap` (Linux, bubblewrap and user namespaces; light, uses the host's tools) or `runtime-docker` (a Docker daemon; stronger isolation, tools come from the image) | `permissions` in `machine.config.js`; `bakers conductor check`, the *Sandbox prerequisites* result (`bwrap`, `socat`, user namespaces) and `docker info` for sandbox prerequisites | The permission mode decides how strictly a run starts: `sandbox` confines the agent, `system` keeps your agent's own policy. | [Execution security](https://bakers.build/provision/security/execution.md) |
| Host runs tickets | Which project grants this machine accepts | `permissions` in `machine.config.js` (an accepted grant) | Accept a project's grants only when you trust everyone who can push to it | Loosening keys in the committed project configuration | A grant is a project setting that loosens the sandbox (a write path, a trusted command, a looser mode) on every machine that accepts it. | [Shared settings](https://bakers.build/provision/security/shared-settings.md) |

### Preview

| When | Decide | Writes | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|---|
| A project needs public previews | Preview-tunnel policy: local or public | `tunnel` in `machine.config.js` | Local only, unless previews must be reachable from outside | `tunnel` in `machine.config.js` | — | [Preview-link tunnels](https://bakers.build/configuration/machine.md#preview-link-tunnels) |
| Previews public | Tunnel transport | `with.transport` of the ports entry in `machine.config.js` `addons` | Cloudflare Quick; a named Cloudflare tunnel or frp when previews need fixed names | `transport` of the ports addon in `machine.config.js` | A quick tunnel needs no account and gets a random `trycloudflare.com` address; a named Cloudflare tunnel needs your own Cloudflare domain and a running connector. | [Ports](https://bakers.build/addons/ports.md) |

### Sign-in

| When | Decide | Writes | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|---|
| Not signed in | Sign-in; ask for a server only when the person names another one | `site.base_url` in `connections/default.js`; the sign-in through `bakers auth login` | `site.base_url: https://app.bakers.build — recommended`, the CLI default, and the device code, the default sign-in profile: its link opens the page with the code filled in for comparison with the terminal | `connections/default.js`; `bakers auth status` | — | [Connection](https://bakers.build/configuration/connection.md) |

### Checkout

| When | Decide | Writes | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|---|
| Remote worker | Projects to check out | Checkouts on the worker; each continues with project setup | — | The person's projects on the control plane | — | [Worker server](https://bakers.build/provision/worker-server.md) |
