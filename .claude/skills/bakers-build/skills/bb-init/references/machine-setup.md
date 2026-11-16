# Machine setup

## Decision matrix

Load the linked documentation when its condition applies, then resolve only missing inputs under
the [setup conversation](setup-conversation.md) rules: one question per block. The documentation
owns configuration syntax and supported options; this matrix owns the setup flow, the evidence
that answers a row and the short recommendation given with each question. Client, application
environment and workflow are project blocks.

### Machine

| When | Decide | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Host role unknown | Host role: whether this host runs tickets, and where: prepared environment, Coder workspace, remote server or this computer | An environment the team already prepared; otherwise this computer | Existing `machine.config.js`; the caller's request | The host role decides whether this machine's conductor takes tickets and where their agents run. | [Choose where agents run](https://bakers.build/provision/machine.md) |
| Host runs tickets | Agent harness to register | The agent already installed and signed in here | The agent this setup runs in; harness addons in `machine.config.js` | — | [Agents](https://bakers.build/agents/index.md), [machine agents](https://bakers.build/configuration/machine.md#agents) |
| Several agents, or states need different agents | Default agent, then routes | One agent; routes only when states need different agents | `agents` in `machine.config.js` | — | [Configure and select agents](https://bakers.build/agents/guide.md) |
| Machine identity missing | Label | — | — | — | [Machine](https://bakers.build/configuration/machine.md) |

### Permissions

Both rows are own decisions.

| When | Decide | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Host runs tickets | Permission mode for every agent on this host | `system` when the host runs only the person's own tickets or works in a trusted environment; otherwise `sandbox`, which needs its prerequisites met | `permissions` in `machine.config.js`; `bakers conductor check` for sandbox prerequisites | The permission mode decides how strictly a run starts: `sandbox` confines the agent, `system` keeps your agent's own policy. | [Execution security](https://bakers.build/provision/security/execution.md), [Isolation models](https://bakers.build/agents/isolation.md) |
| Host runs tickets | Which project grants this machine accepts | Accept a project's grants only when you trust everyone who can push to it | Loosening keys in the committed project configuration | A grant is a project setting that loosens the sandbox (a write path, a trusted command, a looser mode) on every machine that accepts it. | [Shared settings](https://bakers.build/provision/security/shared-settings.md) |

### Preview

| When | Decide | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|
| A project needs public previews | Preview-tunnel policy: local or public | Local only, unless previews must be reachable from outside | `tunnel` in `machine.config.js` | — | [Preview-link tunnels](https://bakers.build/configuration/machine.md#preview-link-tunnels) |
| Previews public | Tunnel transport | Cloudflare Quick; a named Cloudflare tunnel or frp when previews need fixed names | `transport` of the ports addon in `machine.config.js` | A quick tunnel needs no account and gets a random `trycloudflare.com` address; a named Cloudflare tunnel needs your own Cloudflare domain and a running connector. | [Ports](https://bakers.build/addons/ports.md) |

### Sign-in

| When | Decide | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Not signed in | Server URL, then client ID | Device code, the default sign-in profile; another only when the person names it | `connections/default.js`; `bakers auth status` | — | [Connection](https://bakers.build/configuration/connection.md) |

### Checkout

| When | Decide | Recommend | Derive from | Explain | Read |
|---|---|---|---|---|---|
| Remote worker | Projects to check out | — | The person's projects on the control plane | — | [Worker server](https://bakers.build/provision/worker-server.md) |
