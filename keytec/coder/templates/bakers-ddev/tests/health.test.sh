#!/usr/bin/env bash
# health.sh: the Coder dashboard's PM bot, poller and conductor items (AC-10).
source "$(dirname "$0")/lib.sh"

H() { bash "$SCRIPTS/health.sh" "$@"; }
# fake docker: one pm-bot container in state $STATE with $RESTARTS restarts, or none when STATE is empty.
DOCKER_FAKE='case "$1" in
  ps) [ -z "${STATE:-}" ] || echo abc123 ;;
  inspect) echo "$STATE ${RESTARTS:-0}" ;;
esac'

# PM bot.
setup
fake docker "$DOCKER_FAKE"
check "bot running: up" test "$(STATE=running RESTARTS=0 H pm-bot)" = "up (restarts: 0)"
check "bot restarting: down" test "$(STATE=restarting RESTARTS=7 H pm-bot)" = "down (restarting, restarts: 7)"
check "bot exited: down" test "$(STATE=exited RESTARTS=1 H pm-bot)" = "down (exited, restarts: 1)"
check "no bot container: down" test "$(STATE='' H pm-bot)" = "down (no container)"
check "asks for the pm-bot compose project" has "$CALLS" "docker ps -aq --filter label=com.docker.compose.project=pm-bot"
fake docker 'exit 1'
check "docker unreachable: unknown" test "$(H pm-bot)" = "unknown (docker unreachable)"

# Poller: fresh within 60s.
setup
f="$HOME/.pm-bot/data/poller-state.json"
check "no state file: down" test "$(H poller)" = "down (no pass yet)"
mkdir -p "$(dirname "$f")" && echo '{}' >"$f"
age "$f" 20
check "pass 20s ago: up" test "$(H poller)" = "up (last pass 20s ago)"
age "$f" 61
check "pass 61s ago: down" test "$(H poller)" = "down (last pass 61s ago)"

# Conductor: the loop's snapshot, unknown after 90s.
setup
export BAKERS_HEALTH_DIR="$ROOT/health"
fake bakers 'printf "x\t%s\tmore\n" "$(cat .status)"'
mkdir -p "$HOME/projects/site/.bakers" "$HOME/projects/docs/.bakers" "$HOME/projects/plain"
touch "$HOME/projects/site/.bakers/conductor.config.js" "$HOME/projects/docs/.bakers/conductor.config.js"
echo online >"$HOME/projects/site/.status"
echo offline >"$HOME/projects/docs/.status"
check "no snapshot yet: unknown" test "$(H conductor)" = "unknown (no status yet)"
H conductor-once
check "snapshot lists each conductor checkout" test "$(H conductor)" = "docs offline, site online"
check "runs oven status in the checkout" has "$CALLS" "bakers oven status"
age "$BAKERS_HEALTH_DIR/conductor" 91
check "snapshot 91s old: unknown" test "$(H conductor)" = "unknown (no status for 91s)"
rm -rf "$HOME/projects"/*
H conductor-once
check "no conductor checkouts: none" test "$(H conductor)" = "none"

finish
