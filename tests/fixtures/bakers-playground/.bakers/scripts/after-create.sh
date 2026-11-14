#!/bin/bash
# after_create: give a ticket worktree this branch's skills and the connection, then name its
# DDEV project. Under an isolating runtime the worktree has no Git and the run cannot reach the
# parent checkout, so the conductor names the parent and the skills are copied instead of linked.
set -euo pipefail
mkdir -p .claude .bakers
if [ "${BAKERS_RUNTIME_ISOLATES:-0}" = 1 ]; then
  parent="$WORKSPACE_ROOT"
  rm -rf .claude/skills
  cp -rL "$parent/.claude/skills" .claude/skills
else
  parent=$(git worktree list --porcelain | head -1 | cut -c 10-)
  ln -sfn "$parent/.claude/skills" .claude/skills
  exclude=$(git rev-parse --git-path info/exclude)
  for p in .bakers/connection.config.js .claude/skills; do grep -qxF "$p" "$exclude" || echo "$p" >> "$exclude"; done
fi
cp -f "$parent/.bakers/connection.config.js" .bakers/connection.config.js
node .bakers/scripts/setup-worktree.mjs
