# bakers.build Claude Code Marketplace

Standalone marketplace for the bakers.build agent-side `bakers` skill — independent of the keytec
marketplace (`laws-of-robotics`).

## Install (no bakers clone required)

```
/plugin marketplace add https://git.key-tec.de/bakers-build/bakers-build.git
/plugin install bakers@bakers
```

`git.key-tec.de` is a self-hosted GitLab — pass the **full git clone URL**, not a scheme-less
`host/owner/repo` shorthand (which only works for GitHub). The repo is public, so the HTTPS URL
above clones without credentials; if you prefer SSH, use `git@git.key-tec.de:bakers-build/bakers-build.git`
(needs your key on the host).

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
