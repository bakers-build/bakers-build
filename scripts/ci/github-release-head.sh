#!/usr/bin/env bash
# Prints `current` while $RELEASE_BRANCH still points at $RELEASE_HEAD. When a newer push has
# moved it on, prints `superseded` and sets RELEASE_SUPERSEDED=1, which skips the rest of the
# release. Fails when the ref cannot be read: that is a real failure, not a supersession.
set -euo pipefail
head=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$RELEASE_BRANCH" --jq .object.sha)
test -n "$head"
if [ "$head" = "$RELEASE_HEAD" ]; then
  echo current
  exit 0
fi
# stderr: callers capture stdout; the runner reads workflow commands from both streams.
echo "::notice::Release of $RELEASE_HEAD superseded: $RELEASE_BRANCH is now at $head. Skipping the rest of this release." >&2
echo RELEASE_SUPERSEDED=1 >> "$GITHUB_ENV"
echo superseded
