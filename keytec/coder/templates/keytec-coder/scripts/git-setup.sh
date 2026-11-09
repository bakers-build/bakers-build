#!/usr/bin/env bash
# Signs git in with the workspace's service accounts (README › Git), on every start:
#   BOX_GITHUB_TOKEN  gh signs in to github.com and becomes git's credential helper for it
#   BOX_GITLAB_TOKEN  glab signs in to $GITLAB_HOST (default git.key-tec.de), likewise
#   GIT_USER_NAME, GIT_USER_EMAIL  the commit identity
# Not GITHUB_TOKEN/GITLAB_TOKEN: with those set, gh and glab refuse to store a login. A token goes
# to the CLI on stdin only, so it never reaches an argument list, a log or a file outside the CLI's
# own store. An empty token signs its host out, so clearing the parameter revokes an earlier login.
# It never fails the workspace start.
set -uo pipefail

gitlab_host="${GITLAB_HOST:-git.key-tec.de}"

if [ -z "${BOX_GITHUB_TOKEN:-}" ]; then
  gh auth logout --hostname github.com </dev/null >/dev/null 2>&1
  echo "git: github.com skipped (no token; signed out)"
elif printf '%s\n' "$BOX_GITHUB_TOKEN" | gh auth login --hostname github.com --with-token >/dev/null 2>&1 &&
  gh auth setup-git --hostname github.com >/dev/null 2>&1; then
  echo "git: github.com signed in"
else
  echo "git: github.com sign-in failed"
fi

if [ -z "${BOX_GITLAB_TOKEN:-}" ]; then
  glab auth logout --hostname "$gitlab_host" </dev/null >/dev/null 2>&1
  echo "git: $gitlab_host skipped (no token; signed out)"
elif printf '%s\n' "$BOX_GITLAB_TOKEN" | glab auth login --hostname "$gitlab_host" --stdin --git-protocol https >/dev/null 2>&1 &&
  git config --global "credential.https://$gitlab_host.helper" '!glab auth git-credential'; then
  echo "git: $gitlab_host signed in"
else
  echo "git: $gitlab_host sign-in failed"
fi

[ -z "${GIT_USER_NAME:-}" ] || git config --global user.name "$GIT_USER_NAME"
[ -z "${GIT_USER_EMAIL:-}" ] || git config --global user.email "$GIT_USER_EMAIL"
exit 0
