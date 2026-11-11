#!/usr/bin/env bash
set -euo pipefail
if [ "$GITHUB_EVENT_NAME" = pull_request ] && [ "$GITHUB_BASE_REF" = main ]; then
  # The checkout is the PR merge ref: HEAD^2 is the PR head.
  [ "$HEAD_REPOSITORY" = "$GITHUB_REPOSITORY" ] && case "$GITHUB_HEAD_REF" in
    next) true ;;
    release/*) git merge-base --is-ancestor 'HEAD^2' origin/next ;;
    *) false ;;
  esac || {
    echo 'Stable main accepts promotion PRs only from this repository next branch, or a release/* branch whose head is on next.' >&2
    exit 1
  }
fi
if [ "$GITHUB_EVENT_NAME" = push ] && [ "$GITHUB_REF_NAME" = main ]; then
  candidate=$(git rev-parse --verify 'HEAD^2') || {
    echo 'Stable main requires a merge commit preserving the next release candidate.' >&2
    exit 1
  }
  git merge-base --is-ancestor "$candidate" origin/next
  [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse "$candidate^{tree}")" ] || {
    echo 'Stable merge changed the tested next candidate tree.' >&2
    exit 1
  }
fi
