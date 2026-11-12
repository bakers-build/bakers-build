#!/usr/bin/env bash
# Run instructions name operations and conductor tools; local checks and operator setup are exempt.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pattern='merge_requests/[^ ]*/merge|pulls/[^ ]*/merge|git push|git fetch|gh pr |gh api|glab[[:space:]]|ddev[[:space:]]+[[:alnum:]_<]|bakers[[:space:]]+(ports|config|agents|deployment|track)([[:space:]`]|$)|npm[[:space:]]+view|curl[[:space:]]'

# Negative controls keep direct merge requests guarded regardless of HTTP client.
for example in \
  'http PUT https://forge.example/api/v4/projects/1/merge_requests/2/merge' \
  'http PUT https://api.github.example/repos/a/b/pulls/2/merge'; do
  if ! grep -Eq "$pattern" <<< "$example"; then
    printf 'FAIL unguarded merge operation: %s\n' "$example"
    exit 1
  fi
done

# Only operator/setup paths are exempt; tools.md retains its MCP transport fallback.
cd "$root"
mapfile -d '' files < <(find .claude/skills/bakers-build -name '*.md' \
  ! -path '*/bb-init/*' ! -path '*/bb-init-project/*' \
  ! -path '*/bb-upgrade-project/*' ! -path '*/bb-prepare-time/*' \
  ! -name 'read-ticket-troubleshooting.md' -print0)
hits="$(grep -nE "$pattern" "${files[@]}" WORKFLOW.md)" || status=$?
if [ "${status:-0}" -gt 1 ]; then exit "$status"; fi
if [ -n "$hits" ]; then
  printf 'FAIL command lines; describe the operation and discover its tool:\n%s\n' "$hits"
  exit 1
fi
printf 'PASS no unsupported run command lines in the skills or WORKFLOW.md\n'
