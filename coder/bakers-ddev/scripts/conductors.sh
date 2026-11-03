#!/usr/bin/env bash
# Start this workspace's conductors (README › Conductor autostart). install.sh runs it as coder on
# every start, after its services. With the workspace parameter
# conductor_autostart on (BAKERS_CONDUCTOR_AUTOSTART=true), it waits for herdr server and runs
# `bakers oven start` in every ~/projects/* checkout that has .bakers/conductor.config.js. Each
# checkout gets one "conductors: started <path>" or "conductors: failed <path>: <reason>" line in
# the startup log. It never fails the workspace start.
set -uo pipefail

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

for config in "$HOME"/projects/*/.bakers/conductor.config.js; do
  [ -f "$config" ] || continue
  checkout="${config%/.bakers/conductor.config.js}"
  if output=$(cd "$checkout" && bakers oven start --no-update-check 2>&1); then
    echo "conductors: started $checkout"
  else
    echo "conductors: failed $checkout: $(printf '%s' "$output" | tail -n 1)"
  fi
done
exit 0
