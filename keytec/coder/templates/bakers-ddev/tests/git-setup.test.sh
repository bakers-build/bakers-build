#!/usr/bin/env bash
# git-setup.sh: service-account sign-in for gh and glab, credential helpers and identity (AC-3, AC-11).
source "$(dirname "$0")/lib.sh"

GH_TOKEN_VALUE=gh-testtoken-111
GL_TOKEN_VALUE=gl-testtoken-222

# Both tokens: each CLI signs in with the token on stdin, git uses them as credential helpers.
setup
fake gh
fake glab
BOX_GITHUB_TOKEN=$GH_TOKEN_VALUE BOX_GITLAB_TOKEN=$GL_TOKEN_VALUE GITLAB_HOST=git.key-tec.de \
  GIT_USER_NAME="keytec bot" GIT_USER_EMAIL=bot@example.com bash "$SCRIPTS/git-setup.sh" >"$ROOT/out"
check "gh signs in with the token on stdin" has "$STDIN_LOG" "gh: $GH_TOKEN_VALUE"
check "gh login targets github.com" has "$CALLS" "gh auth login --hostname github.com --with-token"
check "gh sets itself up as git credential helper" has "$CALLS" "gh auth setup-git --hostname github.com"
check "glab signs in with the token on stdin" has "$STDIN_LOG" "glab: $GL_TOKEN_VALUE"
check "glab login targets the GitLab host" has "$CALLS" "glab auth login --hostname git.key-tec.de --stdin"
check "git asks glab for git.key-tec.de credentials" \
  test "$(git config --global credential.https://git.key-tec.de.helper)" = '!glab auth git-credential'
check "commit name set" test "$(git config --global user.name)" = "keytec bot"
check "commit email set" test "$(git config --global user.email)" = bot@example.com
check "no token in any argv" lacks "$CALLS" testtoken
check "no token in the home outside the CLIs' stores" lacks "$HOME" testtoken
check "one line per host in the log" test "$(grep -c '^git: ' "$ROOT/out")" -ge 2

# No tokens: both hosts skipped, nothing signed in, identity still set.
setup
fake gh
fake glab
GIT_USER_NAME="keytec bot" GIT_USER_EMAIL=bot@example.com bash "$SCRIPTS/git-setup.sh" >"$ROOT/out"
check "empty tokens: no gh or glab call" test ! -s "$CALLS"
check "empty tokens: github.com skipped" has "$ROOT/out" "git: github.com skipped"
check "empty tokens: GitLab skipped" has "$ROOT/out" "git: git.key-tec.de skipped"
check "empty tokens: identity still set" test "$(git config --global user.email)" = bot@example.com

# A failing login is logged and never fails the start.
setup
fake gh 'exit 1'
fake glab
BOX_GITHUB_TOKEN=$GH_TOKEN_VALUE bash "$SCRIPTS/git-setup.sh" >"$ROOT/out"
check "failing gh login exits 0" test $? -eq 0
check "failing gh login is logged" has "$ROOT/out" "git: github.com sign-in failed"

finish
