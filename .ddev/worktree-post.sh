#!/bin/bash
# Prepare local identity before the sentinel; bootstrap only after successful setup.
set -euo pipefail
node scripts/setup-worktree.mjs
SENTINEL=".bakers/.worktree-post-done"
if [ -f "${SENTINEL}" ]; then
  echo "==> bakers worktree bootstrap already done (${SENTINEL}); skipping." >&2
  exit 0
fi

PARENT_PATH=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
mkdir -p .bakers
# The connection is private (~/.bakers/connections/) and needs no copy; the retired
# conductor.config.local.js and its worktree-local base_url rewrite are gone.
if [ ! -f .bakers/audience.local.md ] && [ -f "${PARENT_PATH}/.bakers/audience.local.md" ]; then
  cp "${PARENT_PATH}/.bakers/audience.local.md" .bakers/audience.local.md
fi

# setup-test-project is the single owner of the conditional CLI build; this mode stays cold.
if [ -f scripts/setup-test-project.sh ]; then
  bash scripts/setup-test-project.sh --workspace-only
fi
touch "${SENTINEL}"
echo "==> bakers worktree bootstrap complete"
