# Machine setup

## Decision matrix

Load the linked documentation when its condition applies, then resolve only missing inputs under
the [setup conversation](setup-conversation.md) rules. The documentation owns configuration syntax
and supported options; this matrix owns the setup flow and the short recommendation given with
each question. Client, application environment and workflow are project rows.

| When | Decide | Recommend | Read |
|---|---|---|---|
| Host role unknown | Whether this host runs tickets, and where: prepared environment, Coder workspace, remote server or this computer | An environment the team already prepared; otherwise this computer | [Choose where agents run](https://bakers.build/provision/machine) |
| Host runs tickets | Agent harness to register | The agent already installed and signed in here | [Agents](https://bakers.build/agents/), [machine agents](https://bakers.build/configuration/machine#agents) |
| Several agents, or states need different agents | Default agent, then routes | One agent; routes only when states need different agents | [Configure and select agents](https://bakers.build/agents/guide) |
| Host runs tickets | Permission mode for every agent on this host, and which project grants it accepts | `system` when the host runs only the person's own tickets or works in a trusted environment; otherwise `sandbox`, which needs its prerequisites met | [Execution security](https://bakers.build/provision/security/execution), [shared settings](https://bakers.build/provision/security/shared-settings), [Isolation models](https://bakers.build/agents/isolation) |
| A project needs public previews | Preview-tunnel policy | Local only, unless previews must be reachable from outside | [Preview-link tunnels](https://bakers.build/configuration/machine#preview-link-tunnels) |
| Machine identity missing | Label | — | [Machine](https://bakers.build/configuration/machine) |
| Not signed in | Server URL, then client ID | Device code, the default sign-in profile; another only when the person names it |  [Connection](https://bakers.build/configuration/connection) |
| Remote worker | Projects to check out | — | [Worker server](https://bakers.build/provision/worker-server) |
