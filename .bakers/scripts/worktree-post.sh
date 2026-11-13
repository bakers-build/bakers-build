#!/bin/bash
# Prepare local identity before the sentinel; bootstrap only after successful setup.
set -euo pipefail
node .bakers/scripts/setup-worktree.mjs
# Register this worktree's own DDEV project (no containers start); unregistered, DDEV falls back
# to the parent checkout. `ddev config` rewrites config.yaml, so the tracked file is kept.
cp .ddev/config.yaml .ddev/config.yaml.keep
ddev config --auto >/dev/null || echo '==> DDEV registration failed; provision_up refuses until it succeeds.' >&2
mv .ddev/config.yaml.keep .ddev/config.yaml
SENTINEL=".bakers/.worktree-post-done"
if [ -f "${SENTINEL}" ]; then
  echo "==> bakers worktree bootstrap already done (${SENTINEL}); skipping." >&2
  exit 0
fi

# The conductor names the parent checkout in WORKSPACE_ROOT: an isolated run's workspace has no Git.
PARENT_PATH="${WORKSPACE_ROOT:-$(git worktree list --porcelain | sed -n '1s/^worktree //p')}"
mkdir -p .bakers
# The connection is private (~/.bakers/connections/) and needs no copy; the retired
# conductor.config.local.js and its worktree-local base_url rewrite are gone.
if [ ! -f .bakers/audience.local.md ] && [ -f "${PARENT_PATH}/.bakers/audience.local.md" ]; then
  cp "${PARENT_PATH}/.bakers/audience.local.md" .bakers/audience.local.md
fi

# setup-test-project is the single owner of the conditional CLI build; this mode stays cold.
if [ -f .bakers/scripts/setup-test-project.sh ]; then
  bash .bakers/scripts/setup-test-project.sh --workspace-only
fi
touch "${SENTINEL}"
echo "==> bakers worktree bootstrap complete"
