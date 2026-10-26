#!/usr/bin/env bash
# A merge request title becomes the squash subject, and the release tool derives version and
# changelog from those subjects, so the title must be a Conventional Commits subject.
# The one copy of the rule: the CI job `mr_title` and the merge step both run
#   bash tests/contract/mr-title.sh "<title>"
set -euo pipefail

RULE='^(feat|fix|chore|docs|refactor|test|ci|build|perf)(\([a-z0-9._/-]+\))?!?: [^[:space:]].*$'
title="${1-}"

if [[ "$title" =~ $RULE ]]; then
  printf 'OK: %s\n' "$title"
  exit 0
fi
printf 'FAIL: the merge request title "%s" is not a Conventional Commits subject.\n' "$title" >&2
printf 'Rule: type(scope)!: subject, type one of feat fix chore docs refactor test ci build perf; scope lower-case and optional; ! marks a breaking change.\n' >&2
printf 'Regex: %s\n' "$RULE" >&2
printf 'Example: feat(stats): new vs. done flow chart\n' >&2
exit 1
