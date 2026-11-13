---
title: Isolation models
description: Compare native agent sandboxes, outer runtimes and operator-provided boundaries, with support and known limits by agent and platform.
---

# Isolation models

## Model, addon, runtime or tool?

These describe different things:

| Concept | Meaning | Example |
|---|---|---|
| **Isolation model** | The boundary you want | A container per agent run |
| **Addon** | A configured JavaScript package contributing capabilities to Bakers | `@bakers-build/addon-runtime-docker` |
| **Runtime** | The implementation that wraps the agent launch, selected in the `runtime` slot | The Docker runtime supplied by that addon |
| **Tool** | An operation the agent calls with inputs and receives a result from | `provision_up(profile)` |

An addon can supply a runtime, tools or other capabilities; these are not synonyms. Harnesses also provide built-in file/shell tools, independently of Bakers addons. A runtime starts automatically during dispatch. A tool is called during work and may execute outside that runtime. See [addons](/addons/build/contracts), [runtime slots](/addons/slots#runtime-where-a-run-starts) and [tools](/provision/tools#work-across-permissions-and-isolation).

## Status words

- **Supported**: released integration; native prerequisites checked by `bakers conductor check`. No blanket security/platform guarantee.
- **Experimental**: opt-in on `next`, unreleased as checked on 13 November 2026; may change.
- **Operator-provided**: you supply the boundary; Bakers does not manage it per run.
- **Not integrated**: no Bakers backend.
- **Unverified**: no live evidence for that combination; preflight/unit tests do not prove isolation.

<span id="isolation-models-1"></span>

## Separation and permissions

These help organize and control work, but do not enclose the whole agent process:

| Mechanism | What it does | How to configure it |
|---|---|---|
| Worktree and agent home | Separates files/settings/plugins; no OS boundary. Cached homes are keyed by harness/marketplace, not private per run. | [Git workspace addon](/addons/workspace-git) and agent marketplaces |
| Agent/tool permissions | Harness rules allow/refuse/prompt for actions. Pi has no built-in permission gate. | [Agent permissions](/provision/security/execution); no outer runtime selected by this setting |

## Isolation boundaries

The model names below describe boundaries, not addon packages or callable tools. Activation is in the next table.

| Model | What is inside | Kernel | Bakers status | Main limit |
|---|---|---|---|---|
| Own OS user | Processes/files governed by that user | Host | Operator-provided | Shared services and readable files remain reachable |
| Native harness sandbox | Harness-defined actions; Claude shell commands/children | Host | Supported: Claude/Codex/Grok; Not integrated: OpenCode/Pi/Kimi | Scope and read/network restrictions vary |
| Outer process sandbox | Entire agent and locally started children | Host | Experimental: Bubblewrap runtime addon | Linux, fresh run clone, shared network; Claude prepared only |
| Container per run | Agent and children in their own container | Host on Linux; engine VM on macOS | Experimental: Docker runtime addon | Claude prepared only; macOS/rewritten allowlist Unverified |
| Conductor container | Conductor and all runs in one container | Container host | Operator-provided | No automatic separation between those runs |
| gVisor | Container processes behind user-space kernel | User-space kernel backed by host | Not integrated | Compatibility/performance need verification |
| VM/microVM per run | Run and guest OS | Separate guest | Not integrated | Docker Sandboxes is distinct from ordinary Docker containers |
| Dedicated VM/host | Entire execution machine | Guest/dedicated host | Operator-provided | No automatic assignment per run |

Bubblewrap and Linux containers share their host kernel. Mounts, privileges, networking and sockets determine access; Docker alone is not stronger.

## How to achieve a boundary

| Desired boundary | Bakers integration or operator work | Activation |
|---|---|---|
| Native sandbox | Agent addon maps policy to harness settings | `permissions: 'sandbox'`; satisfy native prerequisites |
| Outer process sandbox | [Bubblewrap runtime addon](/addons/runtime-bwrap) | Select that machine runtime; example below |
| Container per run | [Docker runtime addon](/addons/runtime-docker) | Select that machine runtime; Podman CLI configurable, not separately live verified here |
| Own user, conductor container, dedicated VM/host | Operator provisions the environment | Start the conductor there with scoped credentials |
| Another per-run backend | No shipped gVisor/microVM backend | [Write a runtime addon](/addons/build/runtime); implement and verify the boundary yourself |

## Native sandbox vs. outer runtime

Claude's native Linux sandbox already uses **Bubblewrap**, plus `socat`. Its OS boundary covers shell commands and their children. Built-in file and web tools follow separate permissions; hooks and local MCP processes are outside that inner shell boundary. bakers.build adds Read-deny rules for Claude's file tool. Whether strict MCP configuration hides plugin MCP servers remains unverified.

Outer `runtime-bwrap` encloses the **whole Claude process**, file tools and locally started children, preserving permission mode. Already-running host services stay outside.

Combine them for a restricted process filesystem plus finer shell policy, given nested sandbox prerequisites. Claude shell egress rules are not a process-wide domain allowlist: `runtime-bwrap` shares networking. Trusted commands leave the inner sandbox but remain inside the outer runtime.

## Outer runtimes (`runtime` slot)

The [`runtime` slot](/addons/slots#runtime-where-a-run-starts) selects execution location (default: host); the executor selects the terminal. Select one runtime in `~/.bakers/machine.config.js`:

```js
// Add one runtime to the existing machine configuration.
runtime: { use: '@bakers-build/addon-runtime-bwrap' },
// Or: runtime: { use: '@bakers-build/addon-runtime-docker' },
```

[Bubblewrap options](/addons/runtime-bwrap#options) and [Docker options](/addons/runtime-docker#options) describe explicit path grants and network choices. Neither runtime changes `permissions` or fixes missing native sandbox prerequisites.

## Support by agent and platform

Native columns describe adapter integration; runtime columns describe the outer boundary independently. Evidence gaps still apply.

| Agent | Native Linux | Native macOS | `runtime-bwrap` Linux | `runtime-bwrap` macOS | `runtime-docker` Linux | `runtime-docker` macOS |
|---|---|---|---|---|---|---|
| Claude | Supported: Bubblewrap + socat, user/network namespaces | Supported: Seatbelt | Experimental: Claude preparation exists | Not integrated: Linux only | Experimental: Claude preparation and default image installation exist | Unverified: Claude preparation exists; macOS not tested |
| Codex | Supported: own sandbox; `codex sandbox true` probe | Supported: Seatbelt | Not prepared, Unverified | Not integrated | Not prepared, Unverified; needs own image | Not prepared, Unverified; needs own image |
| Grok | Supported: Landlock; managed `allow_write` also needs Bubblewrap | Supported integration: Seatbelt; managed profiles Unverified | Not prepared, Unverified | Not integrated | Not prepared, Unverified; needs own image | Not prepared, Unverified; needs own image |
| OpenCode | Not integrated: no Bakers OS sandbox | Not integrated | Not prepared, Unverified | Not integrated | Not prepared, Unverified; needs own image | Not prepared, Unverified; needs own image |
| Pi | Not integrated: no Bakers OS sandbox | Not integrated | Not prepared, Unverified | Not integrated | Not prepared, Unverified; needs own image | Not prepared, Unverified; needs own image |
| Kimi | Not integrated: no permissions policy | Not integrated | Not prepared, Unverified | Not integrated | Not prepared, Unverified; needs own image | Not prepared, Unverified; needs own image |

**Windows / WSL2: Unverified for the complete bakers.build chain.** Upstream support alone does not establish support here. The outer Bubblewrap backend targets Linux only.

Grok's MCP deny-rule enforcement, macOS managed profiles and unattended container execution remain unverified. Native prerequisites are listed in [Run security](/provision/security/execution#sandbox-prerequisites).

## Experimental runtimes: known limits

Release alone does not remove Experimental status. Existing Linux runs provide limited evidence; this overview adds no live checks or broader guarantee.

| Runtime | Known limits |
|---|---|
| Bubblewrap | Linux only; requires `bwrap` and allowed user namespaces, including inside a Coder container. Requires a workspace that provides a run clone. Shares networking, including localhost; no egress allowlist or separate resource limits. Only Claude has run preparation. User hooks fail inside the runtime. |
| Docker | Only Claude has run preparation and an installation command for the default image; other agents need their own image and remain Unverified. Rewritten allowlist mode has no live check. macOS is untested; host networking cannot reach the host there. User hooks fail inside the runtime. The default image lacks `bwrap`/`socat`: native sandbox mode fails closed and consumes retries unless an operator image supplies the tools and working nested namespaces. |

Both runtimes work in a fresh clone of the ticket branch: uncommitted work does not carry over, and only checked commits that change no protected path come back ([isolated Git delivery](/provision/security/shared-settings#isolated-git-delivery)). Conductor tools and project hooks run on the host; under these runtimes each must start in a protected path, but only that entry point is checked. User hooks inside runtimes have separate limits. Read mounts expose contents; write grants allow deletion. Review mounts and credentials.

`bakers conductor check` probes only the host; its runtime warning does not block dispatch. Missing outer prerequisites prevent launch; missing inner prerequisites fail the protected run without switching modes.

## Configuration at a glance

Use **`permissions: 'sandbox'`** for native harness policy; `sandbox` is a separate options object. Default mode is `system`. `yolo` bypasses harness safeguards; `custom` is harness-specific. Neither selects an outer runtime.

[Agent permissions](/provision/security/execution) documents modes, native prerequisites, read/write rules, trusted-command exceptions, network defaults and MCP limits. [Shared settings](/provision/security/shared-settings#harness-support) shows applied/skipped/rejected keys. Inspect effective rules with `bakers agents`. A host preflight does not verify a runtime environment.

## Not covered by any model

The agent can edit/delete granted files, including scripts host tools later execute. A container or VM does not make host execution safe. Review conductor tools, project/Git hooks, Git configuration and worktree automation separately.

Passed credentials remain usable. Scope secrets, network and sockets: a host Docker socket can grant control beyond the container. Cached agent homes are not credential vaults or run separation; private runtime homes are distinct.

Remote MCP and host services enforce their own permissions; allowed requests can cause host actions outside either boundary.

## Choose a model

1. For trusted work, inspect `system` policy and tools.
2. For untrusted tickets, use supported native `sandbox`; check prerequisites and read/network gaps.
3. For host separation, provision a user, conductor container or VM with scoped credentials. Assess separation between runs independently.
4. If you explicitly want to evaluate an outer runtime, compare the Experimental limits above. Bubblewrap is the lightweight Linux process boundary; Docker supplies a per-run image and container environment. Neither closes the host-tool execution gap.
5. For a separate guest kernel per run, a microVM backend is not integrated. Supply and verify that environment yourself.

Setup skills should recommend Experimental runtimes only on request, citing status and limits.
