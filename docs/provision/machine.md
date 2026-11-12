---
prev:
  text: Provision
  link: /provision/
next:
  text: Prepare your project
  link: /get-started/connect-a-project
---

<span id="set-up-a-machine"></span>

# Choose where agents run

Agents need somewhere to run: an existing team environment, a remote server or your own computer. Choose that location first. Reuse its tools and accounts wherever possible. <span id="choose-your-tools"></span>

::: tip Your team already runs this project?
Continue with [ticket work](/get-started/daily-work/create-a-ticket). You can use the web or a connected chat without installing an agent locally.
:::

<span id="choose-the-machine"></span>

## Choose an execution environment

Follow the path that matches what you have access to:

- **An environment already prepared for you:** check access with your team, then [prepare your project](/get-started/connect-a-project) there.
- **A Coder workspace:** open the team's workspace and check its tools and sign-ins there.
- **A remote server you manage:** follow [worker server setup](/provision/worker-server), then connect your project on that server.
- **Your own computer:** check and complete the local setup below.

The bakers.build application server stores tickets and accounts. Hosting it yourself is a separate [task](/self-hosting/server).

## Complete missing setup

Follow these steps only if you are responsible for preparing the chosen environment. Run them there; a remote environment needs its tools and sign-ins on the remote machine. Keep working installations.

**You need:** your account, workspace access, server URL, and an installed, signed-in [Claude Code](/addons/claude#setup) or [Codex](/addons/codex#setup) in that environment.

::: tip Already ready?
[Verify the setup](#verify) and continue with [your project](/get-started/connect-a-project).
:::

<span id="skill-wizard-—-recommended"></span>
<span id="use-the-guided-setup"></span>

<span id="ai-first-install-the-skills"></span>
<span id="1-install-the-skills"></span>

### 1. Install missing skills

Follow [skill installation](/skills-and-workflows/skills) for your chosen agent, then start a new session. That page owns the install commands and update procedure; the skills guide setup and later ticket work.

<span id="2-install-and-sign-in"></span>

### 2. Check tools and sign in

Start a new agent session in the chosen environment. Ask it to check what is ready and guide only the missing steps:

```text
Use `bakers:bb-init` to check this environment for running bakers.build agents.
Check existing tools and settings first. Guide me through missing
prerequisites and my own sign-in. Explain each installation or file
change before applying it. Leave project tooling for project setup.
```

<span id="what-happens-in-the-background"></span>

::: details What the setup changes

The skill checks Git, host [Node.js ≥20.19 and npm](/provision/node), the agent and its [sandbox prerequisites](/provision/security/execution#sandbox-prerequisites). Container Node does not supply the host CLI.

It guides CLI installation and creates only missing private machine/connection settings under `~/.bakers`. The machine's identity, a generated UUID plus a label, is separate from your account. You approve sign-in in your browser; session tokens stay in the private dropsh store. [Connections](/configuration/connection) explains storage. Correct existing settings are reused. Add the installed harness to the machine's `addons` using [Agents](/agents/guide); initialization alone does not supply an agent catalog.
:::

<span id="install-and-sign-in"></span>

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

<span id="verify"></span>

### 3. Verify

**Done when:** Git, Node/npm and the agent answer their checks, `bb-init` is available, authentication passes, and `bakers info` lists your workspace. Ask the AI to report each result. [Troubleshooting](/cli/troubleshooting) covers failures.

### Optional: preview tunnel

To share previews through your team's frp server, follow [frp tunnel › Set up](/addons/ports-frp#set-up) with the server details from your operator. Skip this without them; previews stay local.

**Next:** [Prepare your project](/get-started/connect-a-project) in the chosen environment. Apply the local guide's commands there. You can reuse the same execution setup for more repositories.
