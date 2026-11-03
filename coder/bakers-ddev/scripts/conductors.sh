#!/usr/bin/env bash
# Start this workspace's conductors (README › Conductor autostart). install.sh runs it as coder on
# every start, after its services. With the workspace parameter conductor_autostart on
# (BAKERS_CONDUCTOR_AUTOSTART=true), it waits for herdr server and runs `bakers oven start` in every
# ~/projects/* checkout that has .bakers/conductor.config.js, then checks with `bakers oven status`
# that the conductor is online. Each checkout gets one line in the startup log:
#   conductors: started <path>
#   conductors: failed <path>: <reason>
#   conductors: waiting <path>: <reason>   (retried in the background, see below)
# A stopped workspace kills its conductors without their offline write, so for some minutes after
# a restart `bakers oven start` still takes the dead conductor for a live one and starts nothing.
# Such a checkout is retried in the background until its conductor is online or the retry window
# ends; those lines go to /tmp/bakers-conductors.log. It never fails the workspace start.
set -uo pipefail

RETRY_SECONDS="${BAKERS_CONDUCTOR_RETRY_SECONDS:-30}"
RETRY_FOR="${BAKERS_CONDUCTOR_RETRY_FOR:-720}"
RETRY_LOG="${BAKERS_CONDUCTOR_RETRY_LOG:-${TMPDIR:-/tmp}/bakers-conductors.log}"

if [ "${BAKERS_CONDUCTOR_AUTOSTART:-false}" != true ]; then
  echo "conductors: autostart off"
  exit 0
fi

# herdr hosts each conductor in its own tab, so its server must answer first.
wait_seconds="${BAKERS_CONDUCTOR_WAIT:-60}"
ready=false
for _ in $(seq 1 "$wait_seconds"); do
  if herdr workspace list >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "conductors: skipped: herdr server not ready"
  exit 0
fi

# start CHECKOUT: one start; prints "started", or the reason it is not online. Returns 0 when the
# conductor is online, 1 when the start failed, 2 when it started nothing (not online).
start() {
  local output
  if ! output=$(cd "$1" && bakers oven start --no-update-check 2>&1); then
    printf '%s' "$output" | tail -n 1
    return 1
  fi
  if (cd "$1" && bakers oven status 2>/dev/null) | cut -f2 | grep -qx online; then
    echo started
    return 0
  fi
  printf '%s' "$output" | tail -n 1
  return 2
}

# retry CHECKOUT: in the background, until online or RETRY_FOR seconds have passed.
retry() {
  local waited=0 reason
  while [ "$waited" -lt "$RETRY_FOR" ]; do
    sleep "$RETRY_SECONDS"
    waited=$((waited + RETRY_SECONDS))
    if reason=$(start "$1"); then
      echo "conductors: started $1"
      return 0
    fi
  done
  echo "conductors: failed $1: not online after ${RETRY_FOR}s: $reason"
}

for config in "$HOME"/projects/*/.bakers/conductor.config.js; do
  [ -f "$config" ] || continue
  checkout="${config%/.bakers/conductor.config.js}"
  reason=$(start "$checkout")
  case $? in
    0) echo "conductors: started $checkout" ;;
    1) echo "conductors: failed $checkout: $reason" ;;
    *)
      echo "conductors: waiting $checkout: $reason; retrying in the background ($RETRY_LOG)"
      setsid nohup bash -c "$(declare -f start retry); RETRY_SECONDS=$RETRY_SECONDS RETRY_FOR=$RETRY_FOR retry \"\$1\"" \
        _ "$checkout" >>"$RETRY_LOG" 2>&1 </dev/null &
      ;;
  esac
done
exit 0
