#!/usr/bin/env bash
# Start this workspace's conductors (README › Conductor autostart). install.sh runs it as coder on
# every start, after its services.
# First, on every start and whether autostart is on or off, it cancels the runs the previous
# container left active: a box start is the one moment no agent of them can still run. For every
# worktree branch of a configured checkout (not the checkout's own branch), it finds the ticket
# (bakers_ticket_search), cancels its active runs with reason "box restart" (bakers_run_cancel)
# and, when runs were cancelled, posts one comment on the ticket. The ticket keeps its state, so
# its conductor claims a fresh run. A branch without a ticket, or a ticket with no active run, is
# skipped quietly; any other failure is logged and the start goes on:
#   conductors: box restart cancelled <ticket> (<n> run(s))
#   conductors: box restart cancel failed <branch>: <reason>
# Then, with the workspace parameter conductor_autostart on
# (BAKERS_CONDUCTOR_AUTOSTART=true), it runs `bakers oven start` (detached, no herdr needed) in
# every ~/projects/* checkout that has .bakers/project.config.js (or conductor.config.js, its
# older name), then checks with `bakers oven status` that the conductor is online. `oven` is
# the command on the pinned older releases and an alias of `conductor` on newer ones.
# Each checkout gets one line in the startup log:
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

# configured: the ~/projects/* checkouts with a bakers config.
configured() {
  local checkout
  for checkout in "$HOME"/projects/*; do
    [ -f "$checkout/.bakers/project.config.js" ] || [ -f "$checkout/.bakers/conductor.config.js" ] || continue
    echo "$checkout"
  done
}

# json EXPR ARG...: prints a JavaScript expression over the parsed JSON on stdin (`r`) and argv (`a`).
json() {
  local expr="$1"
  shift
  node -e 'const r = JSON.parse(require("fs").readFileSync(0, "utf8") || "null"); const a = process.argv.slice(1); process.stdout.write(String('"$expr"'))' "$@"
}

# tool CHECKOUT NAME DATA: one `bakers tools` call from the checkout; prints its JSON result, or
# its last error line and returns non-zero.
tool() {
  local err rc=0
  err=$(mktemp)
  (cd "$1" && bakers tools "$2" --data "$3" 2>"$err" </dev/null) || { rc=$?; tail -n 1 "$err"; }
  rm -f "$err"
  return "$rc"
}

# cancel_branch CHECKOUT BRANCH: cancels the active runs of the branch's ticket (see the header).
cancel_branch() {
  local out ticket count runs
  if ! out=$(tool "$1" bakers_ticket_search "$(json 'JSON.stringify({branch_name: a[0]})' "$2" </dev/null)"); then
    echo "conductors: box restart cancel failed $2: $out"
    return
  fi
  ticket=$(printf '%s' "$out" | json 'r.tickets[0] ? r.tickets[0].identifier : ""')
  [ -n "$ticket" ] || return 0
  if ! out=$(tool "$1" bakers_run_cancel "$(json 'JSON.stringify({ticket: a[0], reason: "box restart"})' "$ticket" </dev/null)"); then
    case "$out" in *"no active run"*) ;; *) echo "conductors: box restart cancel failed $2: $out" ;; esac
    return
  fi
  count=$(printf '%s' "$out" | json 'r.runs.length')
  [ "$count" -gt 0 ] 2>/dev/null || return 0
  runs=$(printf '%s' "$out" | json 'r.runs.map((u) => "`" + u + "`").join(", ")')
  echo "conductors: box restart cancelled $ticket ($count run(s))"
  out=$(tool "$1" bakers_comment_publish "$(json 'JSON.stringify({ticket: a[0], type: "comment", body: a[1]})' "$ticket" \
    "Cancelled run(s) $runs: the box restarted, so no agent of them still runs. The ticket gets a fresh run." </dev/null)") \
    || echo "conductors: box restart cancel failed $2: comment: $out"
}

# cancel_box_runs: cancel_branch for every worktree branch of every configured checkout.
cancel_box_runs() {
  local checkout branch
  while read -r checkout; do
    # The first worktree is the checkout itself; its branch is never a ticket's run.
    git -C "$checkout" worktree list --porcelain 2>/dev/null | sed -n 's|^branch refs/heads/||p' | tail -n +2 |
      while read -r branch; do cancel_branch "$checkout" "$branch"; done
  done < <(configured)
}

cancel_box_runs

if [ "${BAKERS_CONDUCTOR_AUTOSTART:-false}" != true ]; then
  echo "conductors: autostart off"
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
  local waited=0 reason=""
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

while read -r checkout; do
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
done < <(configured)
exit 0
