# Set up a machine

Let your AI prepare the reusable host: agent, skills, CLI, identity and sign-in. <span id="choose-your-tools"></span>

Choose the project's TUI and development environment afterwards in [project setup](/get-started/connect-a-project).

**You need:** your own account, workspace access, server URL, and an installed, signed-in [Claude Code](/addons/claude#setup) or [Codex](/addons/codex#setup). Use your existing agent. A chat-only connector cannot install local tools.

Running your own control plane? Follow the separate [server installation](/configuration/project/server). This machine setup can run on a local workstation; Coder and shared preview tunnels are optional.

<span id="skill-wizard-—-recommended"></span>
<span id="use-the-guided-setup"></span>

## AI first: install the skills

Install the bakers plugin **before** asking it to set up the machine. These skills also guide later ticket work.

::: code-group
```text [Claude Code]
/plugin marketplace add https://bakers.build/marketplace.json
/plugin install bakers@bakers
```
```text [Codex — paste into your agent]
Read https://bakers.build/configuration/agents/skills#codex.
Install bakers@bakers from https://github.com/bakers-build/bakers-build,
using the main branch. Check existing marketplace registrations first
and preserve my other plugins. Tell me when to start a new session.
```
:::

[Skill installation](/configuration/agents/skills) explains both paths and the manual commands. Start a new agent session, then ask:

```text
Use `bakers:bb-init` to guide me through installing and setting up bakers.build.
Check existing tools and settings first. Guide me through missing
prerequisites and my own sign-in. Explain each installation or file
change before applying it. Leave project tooling for project setup.
```

## What happens in the background

The skill checks Git, host [Node.js ≥20.19 and npm](/configuration/provisioning/node), the agent and its [sandbox prerequisites](/configuration/agents/execution-security#sandbox-prerequisites). Container Node does not supply the host CLI.

It guides CLI installation and creates only missing private machine/connection settings under `~/.bakers`. Machine identity and the local operator name are separate from your account. You approve sign-in in your browser; session tokens stay in the private dropsh store. [Connections](/configuration/connector/connections) explains storage. Correct existing settings are reused.

## Install and sign in

::: details Manual equivalent — skills are still required
Use your team's pinned version where required. Outside a checkout:

```sh
npm install -g @bakers-build/bakers
bakers --version
bakers init
bakers auth login
bakers auth status
bakers config check --scope connection --online
bakers info
```

Accept your workspace invitation at the server's `/user/login`. `Online: pending` means sign-in remains outstanding. Keep previews local unless sharing is intended.
:::

## Verify

**Done when:** Git, Node/npm and the agent answer their checks, `bb-init` is available, authentication passes, and `bakers info` lists your workspace. Ask the AI to report each result. [Troubleshooting](/configuration/clients/troubleshooting) covers failures.

**Next:** [Set up a project](/get-started/connect-a-project). For remote hosts, use [worker servers](/configuration/machine/worker-server) or [Coder workspaces](/configuration/machine/coder-workspace).
