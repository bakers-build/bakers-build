#!/usr/bin/env bash
# provision_up('conductor-e2e'): a playground conductor from this worktree's build, started
# detached outside the agent sandbox, so a sandboxed run can check live conductor behaviour.
#
#   conductor-e2e.sh            reset the playground, set it up, lower the version gate, start
#   conductor-e2e.sh start      start the playground conductor again, keeping the playground
#   conductor-e2e.sh stop       stop it (`bakers conductor stop`)
#   conductor-e2e.sh teardown   release conductor and playground (after_done); no playground, no-op
#
# The playground lives in the worktree (workspaces/bakers-playground), so the run reads its log and
# edits its config directly. Every ticket the conductor claims starts a paid agent run.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd -P)"
workspace="$root/workspaces/bakers-playground"
bakers="$root/bakers-cli/bin/bakers"

teardown() {
  [ -d "$workspace" ] || return 0
  bash "$root/scripts/teardown-test-project.sh"
}

# start: `conductor start` returns once the detached conductor's first heartbeat arrived.
start() {
  local out id
  out="$(cd "$workspace" && "$bakers" conductor start)"
  echo "$out"
  # Only a fresh start counts: "already running" can be a record whose heartbeat outlived its process.
  id="$(sed -n 's/^started conductor \([^ ]*\) .*/\1/p' <<<"$out" | head -1)"
  [ -n "$id" ] || { echo 'conductor-e2e: conductor start reported no started conductor' >&2; exit 1; }
  cat <<EOF

Playground conductor: $id
  log      $workspace/.bakers/log.txt
  config   $workspace/.bakers/project.config.js, $workspace/.bakers/connection.config.js
  ticket   ddev_exec("drush php:script scripts/e2e/playground-ticket.php -- $id '<title>' [<state>]")
  stop     provision_up('conductor-e2e-stop'); start again: provision_up('conductor-e2e-start')
EOF
}

case "${1:-}" in
  teardown) teardown; exit 0 ;;
  stop) cd "$workspace" && "$bakers" conductor stop; exit 0 ;;
  start) start; exit 0 ;;
  '') ;;
  *) echo "usage: $0 [start|stop|teardown]" >&2; exit 2 ;;
esac

teardown
(cd "$root/bakers-cli" && pnpm -r run build)
# setup-test-project.sh refuses any control plane whose host is not *.ddev.site before any write,
# so the gate below is lowered on this worktree's local site only. The source build reports 0.0.1.
bash "$root/scripts/setup-test-project.sh"
(cd "$root" && ddev drush cset -y bb_core.settings min_client_version 0.0.1)
# No `conductor once` first: its fresh heartbeat makes `conductor start` report "already running" and start
# nothing. `conductor start` registers a missing conductor itself.
start
