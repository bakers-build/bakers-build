#!/usr/bin/env bash
# projects.sh: clones the configured repositories into ~/projects once (AC-1, AC-7).
source "$(dirname "$0")/lib.sh"

# A fake git whose clone creates the checkout and fails for URLs containing "bad".
GIT_FAKE='if [ "$1" = clone ]; then case "$3" in *bad*) exit 128 ;; esac; mkdir -p "$4/.git"; fi'

setup
fake git "$GIT_FAKE"
mkdir -p "$HOME/projects/kept/.git" && echo mine >"$HOME/projects/kept/file"
BOX_PROJECTS="https://github.com/acme/site.git, https://git.key-tec.de/acme/bad-repo.git
https://git.key-tec.de/acme/kept.git https://git.key-tec.de/acme/other" bash "$SCRIPTS/projects.sh" >"$ROOT/out"
check "missing repo cloned into ~/projects/<name>" test -d "$HOME/projects/site/.git"
check "repo URL without .git" test -d "$HOME/projects/other/.git"
check "clone command" has "$CALLS" "git clone --quiet https://github.com/acme/site.git $HOME/projects/site"
check "existing checkout not touched" lacks "$CALLS" "acme/kept"
check "existing checkout content kept" test "$(cat "$HOME/projects/kept/file")" = mine
check "bad URL logged" has "$ROOT/out" "projects: failed https://git.key-tec.de/acme/bad-repo.git"
check "next URL after a bad one still cloned" has "$ROOT/out" "projects: cloned $HOME/projects/other"
check "existing logged" has "$ROOT/out" "projects: kept $HOME/projects/kept"

# A non-HTTPS URL is refused before git runs.
setup
fake git "$GIT_FAKE"
BOX_PROJECTS="git@github.com:acme/site.git" bash "$SCRIPTS/projects.sh" >"$ROOT/out"
check "non-HTTPS: no git call" test ! -s "$CALLS"
check "non-HTTPS: logged" has "$ROOT/out" "projects: skipped git@github.com:acme/site.git (not an https:// URL)"

# None configured: nothing.
setup
fake git "$GIT_FAKE"
bash "$SCRIPTS/projects.sh" >"$ROOT/out"
check "none: exit 0 and no git call" test ! -s "$CALLS"

finish
