---
title: Agent permissions and isolation
description: How agent permissions, isolation boundaries and conductor tools fit together, with links to each detail page.
---

# Agent permissions and isolation

An agent edits code, runs checks and delivers its work. Three layers decide what it can reach, and you configure each one separately:

1. **Permissions** decide which actions the harness allows, refuses or asks you to approve.
2. **Isolation** decides which files, processes, network and credentials the agent process can reach at all.
3. **Tools** perform the operations the agent needs beyond both, with their own authority.

<span id="security"></span>
<span id="choose-both-layers"></span>

## How the layers fit together

| Layer | Controls | Enforced by | Configured in | Details |
|---|---|---|---|---|
| Permissions | Allowed actions, read and write paths, trusted commands, network and MCP rules | The harness; in `sandbox` mode also its native OS sandbox | `permissions` in the machine or project config, or the agent entry | [Agent permissions](/provision/security/execution), [Configure permissions](/provision/security/shared-settings) |
| Isolation | Everything the agent process and its children can reach | An outer runtime (Bubblewrap, Docker) or an environment you provide (own user, container, VM) | The `runtime` slot in `~/.bakers/machine.config.js`, or where you start the conductor | [Isolation models](/agents/isolation) |
| Tools | Operations outside the agent's reach: environments, checks, forge, previews | The conductor or an addon, in its own environment | Addons and the `provision_up` / `provision_exec` hooks | [Tools and integrations](/provision/tools) |
| Credentials and access | Secrets a run holds; tickets and data an account sees | The conductor and server roles | Conductor environment and workspace roles | [API keys](/provision/security/credentials), [Access and data](/provision/security/access-and-data) |

The layers do not replace each other. `permissions: 'sandbox'` asks a supported harness to enforce its own policy, and that scope varies: Claude's native sandbox covers shell commands, Codex's restricts writes but not reads, and OpenCode and Pi have no OS sandbox through their Bakers adapters. An outer runtime encloses the whole agent process and keeps the permission mode; choosing a mode never selects a runtime. A Git worktree or an application container does not isolate the agent by itself. Check the [agent/platform matrix](/agents/isolation#support-by-agent-and-platform) before relying on a boundary.

<span id="model-addon-runtime-or-tool"></span>

### Terms

| Term | Meaning | Example |
|---|---|---|
| **Permission mode** | How strictly the harness applies its rules | `sandbox`, `system`, `yolo`, `custom` |
| **Isolation model** | The boundary you want around the agent | A container per agent run |
| **Addon** | A configured package contributing capabilities to Bakers | `@bakers-build/addon-runtime-docker` |
| **Runtime** | The implementation that wraps the agent launch, selected in the [`runtime` slot](/addons/slots#runtime-where-a-run-starts) | The Docker runtime from that addon |
| **Tool** | An operation the agent calls with inputs and gets a result from | `provision_up(profile)` |

An addon can supply a runtime, tools or both. A runtime starts at dispatch; a tool is called during work and may execute outside that runtime. Harnesses also bring their own file and shell tools, independently of Bakers addons.

<span id="tools-and-isolation-strategy"></span>
<span id="provision-up-and-addon-tools"></span>

## Tools make restricted runs useful

1. Keep the agent's own actions and filesystem access limited to its work.
2. Expose the operations it needs as configured conductor tools: prepare an environment, run checks, access the forge or share a preview.
3. Let the integration hold the required credentials and execute the operation in its intended environment.

`provision_up(profile)` prepares the application while the agent's shell stays restricted. Forge tools push and prepare a PR without giving the agent the forge token. `provision_exec('web', [...])` runs the project's configured command, for example in a site container, whose mounts and credentials then determine its reach.

Tools have their **own authority**: permission rules decide whether a call is allowed, the tool validates its inputs, and its environment determines what it can do. A host command that loads agent-editable code runs it with host rights. Under an isolating runtime, bakers requires every host command to start in a protected path but checks only that entry point; review what it calls.

<span id="configure-and-verify"></span>

## Configure and verify

- Inspect `bakers agents` for effective permission modes, rules and sources. `bakers conductor check` checks native sandbox prerequisites on the host, not inside a selected runtime.
- Outer Docker and Bubblewrap runtimes are **Experimental**; choose them only when you explicitly want that option. They run each agent in a fresh clone and return only checked commits ([isolated Git delivery](/provision/security/shared-settings#isolated-git-delivery)).
- Verify allowed and refused operations in their actual execution environments; a preflight is not an isolation test.

## Details

<DocTiles :tiles="[
  { title: 'Agent permissions', text: 'Modes, native sandbox prerequisites, read and write rules, network and MCP limits per harness.', link: '/provision/security/execution', icon: 'terminal', meta: 'Choose allowed actions →' },
  { title: 'Configure permissions', text: 'Share one permissions block across agents in machine and project config, and see what each harness applies.', link: '/provision/security/shared-settings', icon: 'settings', meta: 'Configure →' },
  { title: 'Isolation models', text: 'Compare sandboxes, runtimes, containers and VMs, with support by agent and platform and known limits.', link: '/agents/isolation', icon: 'layers', meta: 'Choose a boundary →' },
  { title: 'Tools and integrations', text: 'Which operations agents call through addons, and what each one can reach.', link: '/provision/tools', icon: 'plug', meta: 'Understand tools →' }
]" />

Also: [API keys and service accounts](/provision/security/credentials), [Access and data](/provision/security/access-and-data), [Write a runtime addon](/addons/build/runtime).

**Next:** [verify independent operation](/provision/guide#verify-independent-operation), then [run a ticket](/get-started/first-ticket).
