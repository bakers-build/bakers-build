#!/usr/bin/env bash
# bakers-setup.sh: the bakers.build sign-in with the workspace's OAuth client (AC-1, AC-5).
source "$(dirname "$0")/lib.sh"

SECRET=bk-secret-333

# No connection yet: init with client credentials, the secret only through the environment.
setup
fake bakers 'if [ "$1" = init ]; then mkdir -p "$HOME/.bakers"; echo "secret=$BAKERS_CLIENT_SECRET" >"$HOME/.bakers/bakers.config.js"; fi'
BAKERS_URL=https://bakers.example BAKERS_CLIENT_ID=box-client BAKERS_CLIENT_SECRET=$SECRET WORKSPACE_NAME=box-1 \
  bash "$SCRIPTS/bakers-setup.sh" >"$ROOT/out"
check "init with client credentials" has "$CALLS" \
  "bakers init --base-url https://bakers.example --auth-type client_credentials --client-id box-client --secret-env BAKERS_CLIENT_SECRET --label box-1 --yes"
check "then auth login" has "$CALLS" "bakers auth login"
check "secret not in argv" lacks "$CALLS" "$SECRET"
check "init saw the secret in its environment" has "$HOME/.bakers/bakers.config.js" "secret=$SECRET"
check "logged as signed in" has "$ROOT/out" "bakers: signed in to https://bakers.example"

# An existing connection: no new init, the session is renewed with auth login.
setup
fake bakers
mkdir -p "$HOME/.bakers" && echo 'export default {};' >"$HOME/.bakers/bakers.config.js"
BAKERS_URL=https://bakers.example BAKERS_CLIENT_ID=box-client BAKERS_CLIENT_SECRET=$SECRET WORKSPACE_NAME=box-1 \
  bash "$SCRIPTS/bakers-setup.sh" >"$ROOT/out"
check "existing connection: no init" lacks "$CALLS" "bakers init"
check "existing connection: auth login" has "$CALLS" "bakers auth login"
check "existing connection: logged" has "$ROOT/out" "bakers: signed in (existing connection)"

# init succeeds but auth login fails: the next start logs in again, without anyone running init.
setup
fake bakers 'case "$1" in
  init) mkdir -p "$HOME/.bakers"; echo "export default {};" >"$HOME/.bakers/bakers.config.js" ;;
  auth) [ -f "$HOME/login-failed-once" ] || { touch "$HOME/login-failed-once"; exit 1; } ;;
esac'
run() { BAKERS_URL=https://bakers.example BAKERS_CLIENT_ID=box-client BAKERS_CLIENT_SECRET=$SECRET WORKSPACE_NAME=box-1 \
  bash "$SCRIPTS/bakers-setup.sh" >"$ROOT/out"; }
run
check "first start: login failure logged" has "$ROOT/out" "bakers: sign-in failed"
check "first start: no manual repair asked" lacks "$ROOT/out" "by hand"
: >"$CALLS"
run
check "second start: auth login again" has "$CALLS" "bakers auth login"
check "second start: no second init" lacks "$CALLS" "bakers init"
check "second start: signed in" has "$ROOT/out" "bakers: signed in (existing connection)"

# No client: skipped.
setup
fake bakers
BAKERS_URL=https://bakers.example bash "$SCRIPTS/bakers-setup.sh" >"$ROOT/out"
check "no client: no bakers call" test ! -s "$CALLS"
check "no client: logged" has "$ROOT/out" "bakers: skipped"

# A failing init is logged, never fails the start, and skips the login.
setup
fake bakers 'exit 3'
BAKERS_URL=https://bakers.example BAKERS_CLIENT_ID=box-client BAKERS_CLIENT_SECRET=$SECRET WORKSPACE_NAME=box-1 \
  bash "$SCRIPTS/bakers-setup.sh" >"$ROOT/out"
check "failing init exits 0" test $? -eq 0
check "failing init: no login" lacks "$CALLS" "auth login"
check "failing init: logged" has "$ROOT/out" "bakers: sign-in failed"

finish
