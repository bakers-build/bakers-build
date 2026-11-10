#!/bin/bash
# Fails unless DDEV resolves this worktree's own project. An unregistered worktree makes DDEV
# fall back to the registered parent checkout and run the parent's commands, so the check runs
# from the worktree's own files before any `ddev` call that acts on a project.
set -euo pipefail
root="$(realpath "$(git rev-parse --show-toplevel)")"
approot="$( (ddev describe -j 2>/dev/null || true) | node --input-type=module -e '
import { readFileSync, realpathSync } from "node:fs";
try {
  const raw = JSON.parse(readFileSync(0, "utf8").trim().split("\n").pop()).raw;
  console.log(realpathSync(raw.approot));
} catch {}
')"
if [ "$approot" != "$root" ]; then
  echo "DDEV resolves the project at ${approot:-(none)}, not this worktree ($root); run bash .ddev/worktree-post.sh to register it." >&2
  exit 1
fi
