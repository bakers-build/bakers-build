# Set up bakers.build

**Add bakers.build to your agent. Your agent guides you through every step.**

**You need:** a bakers.build account with access to your team's workspace.

## Skill wizard — recommended

Add the bakers.build plugin to your agent:

::: code-group

```text [Claude Code]
/plugin marketplace add https://git.key-tec.de/bakers-build/bakers-build.git
/plugin install bakers@bakers
```

```text [Codex]
codex plugin marketplace add https://git.key-tec.de/bakers-build/bakers-build.git
codex plugin add bakers@bakers
```

:::

Then paste this prompt:

```text
Use `bakers:bb-init` to guide me through installing and setting up bakers.build.
```

The wizard explains your choices, checks your tools and signs you in. You decide; the wizard guides and checks.

## What goes on your machine

| Part | Why | Who installs it |
|---|---|---|
| The bakers.build plugin in your agent | Gives your agent the bakers.build skills | You, with the two lines above |
| Your agent's own CLI and subscription | The agent that does the work, for example Claude Code or Codex | You already have it |
| The `bakers` command | Talks to the bakers.build server and runs your conductor | The wizard tells you when it is missing |
| A workspace manager (herdr today) | Keeps one terminal tab open per ticket | You, guided by the wizard |
| Your project's development environment | Whatever the project needs, such as DDEV | You already have it for the project |

Nothing is installed for you; the wizard checks and points to the right page when something is missing.

## Work in the browser

Create and plan tickets straight from claude.ai, with nothing to install: [connect claude.ai](/daily-work/claude-ai).

## Next

[Connect your project →](/get-started/connect-a-project)

Prefer the terminal? [Set up with the CLI](/advanced/cli/install).
