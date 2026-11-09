#!/usr/bin/env bash
# The Coder dashboard's health items (README › Health), one line each:
#   health pm-bot          the PM bot container: up, or down with its state; restarts counted
#   health poller          the poller: up while its state file is at most 60s old (one pass per 15s)
#   (both print "off" when the workspace has no PM bot image or Slack token)
#   health conductor       the snapshot conductor-loop writes: unknown when older than 90s
#   health conductor-loop  every 30s, `bakers oven status` of each ~/projects/* conductor checkout
#   health conductor-once  one snapshot
# The conductor items read a snapshot because a metadata script must answer within its timeout.
set -uo pipefail

dir="${BAKERS_HEALTH_DIR:-${TMPDIR:-/tmp}/bakers-health}"
age_of() { echo $(($(date +%s) - $(date -r "$1" +%s))); }
bot_configured() { [ -n "${PM_BOT_IMAGE:-}" ] && [ -n "${PM_BOT_SLACK_BOT_TOKEN:-}" ]; }

pm_bot() {
  local id state restarts
  if ! bot_configured; then
    echo "off (not configured)"
  elif ! id=$(docker ps -aq --filter label=com.docker.compose.project=pm-bot 2>/dev/null); then
    echo "unknown (docker unreachable)"
  elif [ -z "$id" ]; then
    echo "down (no container)"
  else
    read -r state restarts < <(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "${id%%$'\n'*}" 2>/dev/null)
    if [ -z "$state" ]; then echo "down (gone)"; return; fi
    if [ "$state" = running ]; then echo "up (restarts: $restarts)"; else echo "down ($state, restarts: $restarts)"; fi
  fi
}

poller() {
  local f="$HOME/.pm-bot/data/poller-state.json" age
  bot_configured || { echo "off (not configured)"; return; }
  [ -f "$f" ] || { echo "down (no pass yet)"; return; }
  age=$(age_of "$f")
  if [ "$age" -le 60 ]; then echo "up (last pass ${age}s ago)"; else echo "down (last pass ${age}s ago)"; fi
}

conductor() {
  local f="$dir/conductor" age
  [ -f "$f" ] || { echo "unknown (no status yet)"; return; }
  age=$(age_of "$f")
  if [ "$age" -gt 90 ]; then echo "unknown (no status for ${age}s)"; else cat "$f"; fi
}

conductor_once() {
  local config checkout status parts=()
  for config in "$HOME"/projects/*/.bakers/conductor.config.js; do
    [ -f "$config" ] || continue
    checkout="${config%/.bakers/conductor.config.js}"
    status=$(cd "$checkout" && timeout 20 bakers oven status 2>/dev/null | head -n 1 | cut -f2)
    parts+=("$(basename "$checkout") ${status:-unknown}")
  done
  mkdir -p "$dir"
  local IFS=,
  local line="${parts[*]:-none}"
  printf '%s\n' "${line//,/, }" >"$dir/conductor.tmp" && mv "$dir/conductor.tmp" "$dir/conductor"
}

case "${1:-}" in
  pm-bot) pm_bot ;;
  poller) poller ;;
  conductor) conductor ;;
  conductor-once) conductor_once ;;
  conductor-loop) while true; do conductor_once; sleep 30; done ;;
  *) echo "usage: health pm-bot|poller|conductor|conductor-loop|conductor-once" >&2; exit 2 ;;
esac
