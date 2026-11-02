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
for file in conductor.config.local.js audience.local.md; do
  if [ ! -f ".bakers/${file}" ] && [ -f "${PARENT_PATH}/.bakers/${file}" ]; then
    cp "${PARENT_PATH}/.bakers/${file}" ".bakers/${file}"
  fi
done

# setup-worktree validates this value; never evaluate the env file as shell code.
WORKTREE_URL=$(sed -n 's/^PLAYWRIGHT_BASE_URL=//p' .env.ddev | tail -1)
if [ -f .bakers/conductor.config.local.js ]; then
    BB_WORKTREE_URL="${WORKTREE_URL}" perl -0pi -e '
      my $marker = " // BB-154 worktree-local base_url";
      s/\n[ \t]*base_url:[^\n]*\Q$marker\E(?=\n)//g;
      my $url = $ENV{BB_WORKTREE_URL};
      s/,?\s*\};\s*\z/,\n  base_url: '"'"'$url'"'"',$marker\n};\n/;
    ' .bakers/conductor.config.local.js
fi

# setup-test-project is the single owner of the conditional CLI build; this mode stays cold.
if [ -f scripts/setup-test-project.sh ]; then
  bash scripts/setup-test-project.sh --workspace-only
fi
touch "${SENTINEL}"
echo "==> bakers worktree bootstrap complete"
