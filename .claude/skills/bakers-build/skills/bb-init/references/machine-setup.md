# Machine setup

## Decision matrix

Load the linked documentation when its condition applies, then resolve only missing inputs under
the [setup conversation](setup-conversation.md) rules. The documentation owns configuration syntax
and supported options; this matrix owns the setup flow. Client, application environment and
workflow are project rows.

| When | Decide | Read |
|---|---|---|
| Always | Whether this host runs tickets, and where: prepared environment, Coder workspace, remote server or this computer | [Choose where agents run](https://bakers.build/provision/machine) |
| Host runs tickets | Agent harness to register | [Agents](https://bakers.build/agents/), [machine agents](https://bakers.build/configuration/machine#agents) |
| Several agents, or states need different agents | Default agent, then routes | [Configure and select agents](https://bakers.build/agents/guide) |
| A project needs public previews | Preview-tunnel policy | [Preview-link tunnels](https://bakers.build/configuration/machine#preview-link-tunnels) |
| Machine identity missing | Label | [Machine](https://bakers.build/configuration/machine) |
| Not signed in | Server URL, client, then sign-in | [Connection](https://bakers.build/configuration/connection) |
| Remote worker | Projects to check out | [Worker server](https://bakers.build/provision/worker-server) |
