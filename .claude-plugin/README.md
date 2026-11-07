# bakers.build agent marketplace

Standalone marketplace for the bakers.build agent-side `bakers` skill — independent of the keytec
marketplace (`laws-of-robotics`).

## Install (no bakers clone required)

Claude Code (v2.1.224 or later), without git or an account:

```
/plugin marketplace add https://bakers.build/marketplace.json
/plugin install bakers@bakers
```

`https://docs-develop.dev.bakers.build/marketplace.json` serves `develop`. The docs build
(`docs/scripts/marketplace.mjs`) writes that catalog from this file, with the plugin as a zip
behind an `archive` source pinned by sha256.

Codex, from the public GitHub repository:

```sh
codex plugin marketplace add https://github.com/bakers-build/bakers-build --ref main
codex plugin add bakers@bakers
```

Always select `main` for stable skills, independently of the repository's default branch.
See the [installation guide](https://bakers.build/skills-and-workflows/skills)
for existing registrations, verification and updates.

## What ships

- **`bakers`** — the repo-agnostic ticket-workflow engine (`/bakers`). Reads the target repo's
  `WORKFLOW.md` and `.bakers/conductor.config.js` at runtime, so it works from any bakers.build project.

**Not shipped:** the manual skill-testing wiring, `scripts/setup-test-project.sh` and
`scripts/teardown-test-project.sh`. Neither is a skill — they are two shell scripts, and they stay
repo-local because they drive this checkout's own DDEV control plane and clone the fixture project
committed under `tests/fixtures/bakers-playground`.

## Single source of truth

The plugin's `source` points at `.claude/skills/bakers-build` — the same directory Claude Code loads as a
project skill inside the bakers repo. There is no copy and nothing to sync.

## Independence

This marketplace is **not** part of and must **not** be registered under the keytec marketplace.
The two are fully independent.
