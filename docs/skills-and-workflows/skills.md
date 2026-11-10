# Install the bakers skills

Skills give your AI the setup wizard and ticket methods. Install them into each agent that will run setup or tickets. The plugin contains instructions; the bakers CLI is a separate executable, and a chat connector only provides access to the server.

**You need:** a signed-in Claude Code or Codex installation. Claude uses the official bakers.build catalog; Codex uses the public [bakers-build repository](https://github.com/bakers-build/bakers-build) with the stable `main` branch. No private repository credentials are needed.

## Claude Code

Run in Claude Code:

```text
/plugin marketplace add https://bakers.build/marketplace.json
/plugin install bakers@bakers
```

The marketplace points to a versioned ZIP on bakers.build with a SHA-256 checksum. Claude downloads the plugin and makes its skills available. Start a new session before invoking `bakers:bb-init`.

## Codex

Ask Codex to install the skills:

```text
Read https://bakers.build/skills-and-workflows/skills#codex.
Install bakers@bakers from https://github.com/bakers-build/bakers-build,
using the main branch. Check existing marketplace registrations first
and preserve my other plugins. Tell me when to start a new session.
```

<span id="manual-download-for-codex"></span>

### Manual equivalent

Run in your terminal:

```sh
codex plugin marketplace add https://github.com/bakers-build/bakers-build.git --ref main
codex plugin add bakers@bakers
codex plugin marketplace list
```

Codex fetches the Git repository over HTTPS, reads its marketplace and installs the plugin from `.claude/skills/bakers-build`. `--ref main` selects stable skills even when the repository's default development branch is `next`. A hosted JSON catalog is not a supported Codex marketplace source; no manual ZIP download or local marketplace file is needed. See [Codex's plugin documentation](https://developers.openai.com/plugins/build/plugins).

If `bakers` is already registered from an older Git or local-download source, inspect it with `codex plugin marketplace list` first. Replace that registration deliberately before adding the GitHub source; preserve unrelated marketplaces and plugins. A fresh installation can use the commands directly.

## Verify in a new session

Ask: “Find the installed `bb-init`, `bb-init-project` and `bb-workflow` skills and tell me what each does.” They must be discoverable before you ask the AI to prepare the machine. If missing, check that the plugin is enabled in this agent, then start a fresh session. [Machine setup](/provision/machine#ai-first-install-the-skills) continues with `bb-init`.

The shipped Matt recipe is included. Project-specific runtime, design or testing skills named by `WORKFLOW.md` must also be available; a project declares their plugins once as [agent plugins](/configuration/project#agent-plugins), and the conductor installs them for every run. The project wizard reports missing names. Installing the CLI alone does not install these instructions.

## Updates

Claude can refresh the marketplace and update the plugin through its plugin manager. For Codex, `codex plugin marketplace upgrade bakers` refreshes the registered Git source; update the installed plugin through Codex's plugin manager. Keep the source pinned to `main`. Restart the agent and verify its skills again. Keep [CLI/configuration updates](/configuration/machine/updates) separate.
