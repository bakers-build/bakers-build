---
title: Agent permissions and isolation
description: Choose the agent's permissions and its execution boundary separately, then provide required operations through conductor tools.
---

# Agent permissions and isolation

An agent needs to edit code, run checks and deliver its work. Decide **what it may do** and **where its process may reach** separately. Then provide the operations it needs through configured **tools**, so routine work does not require broad shell access or host credentials.

<span id="security"></span>

## Choose both layers

<DocTiles :tiles="[
  { title: 'Agent permissions', text: 'Choose which actions the harness allows, refuses or asks you to approve, including native sandbox policy.', link: '/provision/security/execution', icon: 'terminal', meta: 'Choose allowed actions →' },
  { title: 'Isolation', text: 'Choose which files, processes, network and credentials the agent process can reach.', link: '/agents/isolation', icon: 'terminal', meta: 'Choose the execution boundary →' }
]" />

Configure the first layer with [machine and project permissions](/provision/security/shared-settings). Compare native sandboxes, outer process runtimes, conductor containers and separate machines for the second.

These layers work together. `permissions: 'sandbox'` asks a supported harness to enforce its own policy, including native OS restrictions. That policy's scope varies: Claude's native sandbox covers shell commands, while an outer runtime can enclose the entire agent process. Choosing a runtime preserves the permission mode; choosing a permission mode does not select an outer runtime.

For example, Codex's native sandbox restricts writes but does not confine reads. OpenCode and Pi have no OS sandbox through their Bakers adapters. An application container or Git worktree does not automatically isolate the agent. Check the [agent/platform matrix](/agents/isolation#support-by-agent-and-platform) before relying on a boundary.

<span id="tools-and-isolation-strategy"></span>
<span id="provision-up-and-addon-tools"></span>

## Tools make restricted runs useful

Use [Tools and integrations](/provision/tools) as the common approach for both layers:

1. Keep the agent's own actions and filesystem access limited to its work.
2. Expose the operations it needs as configured conductor tools: prepare an environment, run checks, access the forge or share a preview.
3. Let the integration hold the required credentials and execute the operation in its intended environment.

`provision_up(profile)` can prepare the application while the agent's shell stays restricted. Forge tools can push and prepare a PR without giving the agent the conductor's forge token. DDEV tools can execute checks in the application container while the agent stays in its own runtime.

Tools have their **own authority**. Agent permission rules govern whether a call is allowed; the tool implementation must validate its inputs and authorization, and its execution environment determines its reach. A host tool remains outside the agent's isolation. `ddev_status()` reports status, while `provision_exec('web', [...])` can run commands in a site container; that container's mounts, credentials and network access determine what those commands can reach. A host command that loads agent-editable code runs it with host rights. Under an isolating runtime, bakers requires every host command to start in a protected path, but checks only that entry point; review what it calls.

<span id="configure-and-verify"></span>

## Configure and verify

- Inspect `bakers agents` for effective permission modes, rules and sources. Run `bakers conductor check` for supported native sandbox prerequisites; it checks the host, not the selected runtime's environment.
- Choose isolation from its documented support and limits. Outer Docker and Bubblewrap runtimes are **Experimental**; evaluate them only when you explicitly want that option. They run each agent in a fresh clone and return only checked commits ([isolated Git delivery](/provision/security/shared-settings#isolated-git-delivery)).
- Configure required tools and scoped [credentials](/provision/security/credentials). Verify allowed and refused operations in their actual execution environments; a preflight is not an isolation test.
- Review [account access, data and public previews](/provision/security/access-and-data) separately. Workspace membership does not define OS permissions.

**Next:** [verify independent operation](/provision/guide#verify-independent-operation), then [run a ticket](/get-started/first-ticket).
