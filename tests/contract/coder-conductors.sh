#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Behaviour of the bakers-ddev template's conductor autostart
# (coder/bakers-ddev/scripts/conductors.sh), with herdr and bakers stubs on
# PATH and a temporary HOME. Nothing real starts.
#
#   bash tests/contract/coder-conductors.sh
#
# Asserts:
#   - box start, autostart on or off: before any `bakers oven start`, every
#     worktree branch of a configured checkout (not the checkout's own) is
#     resolved with bakers_ticket_search and gets one bakers_run_cancel with
#     reason "box restart"; a ticket whose cancel returned runs gets one
#     bakers_comment_publish of type comment; a branch with no ticket or a
#     "no active run" refusal is skipped quietly; a failing call is logged with
#     its branch and the rest still runs
#   - autostart off (unset or false): one "off" line, only the cancel calls
#   - on: every ~/projects/* checkout with .bakers/project.config.js, or the
#     conductor.config.js of a release before it, gets one `bakers oven start`
#     run from inside it (`oven` works on old and new releases); a directory
#     without one does not
#   - a failing start is named with its path and the others still start
#   - herdr is never asked: the detached start does not need it
#   - a start that leaves the conductor not online (a stale "already running"
#     after a hard stop) is retried in the background until it is online
#   - it always exits 0
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/coder/bakers-ddev/scripts/conductors.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# --- Stubs ------------------------------------------------------------------
# Each stub appends "<name> <args> @ <cwd>" to $CALLS. HERDR_DOWN makes herdr
# fail; BAKERS_FAIL names a checkout directory whose start fails.
STUB="$SCRATCH/stub"
mkdir -p "$STUB"
cat > "$STUB/herdr" <<'EOF'
#!/usr/bin/env bash
printf 'herdr %s @ %s\n' "$*" "$PWD" >> "$CALLS"
[ -z "${HERDR_DOWN:-}" ]
EOF
# `bakers tools` answers from the branch: t/<TICKET> is ticket <TICKET>,
# t/none has no ticket; CANCEL_IDLE names a ticket with no active run,
# CANCEL_FAIL one whose cancel fails on the transport.
# BAKERS_STALE names a checkout whose first STALE_STARTS starts only say
# "already running" (exit 0) and leave it offline, as after a hard stop.
cat > "$STUB/bakers" <<'EOF'
#!/usr/bin/env bash
printf 'bakers %s @ %s\n' "$*" "$PWD" >> "$CALLS"
name="$(basename "$PWD")"
if [ "${1:-}" = tools ]; then
  data="$4"
  case "$2" in
    bakers_ticket_search)
      t="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).branch_name.replace(/^t\//, ""))' "$data")"
      if [ "$t" = none ]; then echo '{"tickets":[]}'; else printf '{"tickets":[{"identifier":"%s"}]}\n' "$t"; fi ;;
    bakers_run_cancel)
      t="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).ticket)' "$data")"
      if [ "$t" = "${CANCEL_IDLE:-}" ]; then echo '{"error":{"code":"E_TOOL","message":"Ticket '"$t"' has no active run."}}' >&2; exit 1; fi
      if [ "$t" = "${CANCEL_FAIL:-}" ]; then echo '{"error":{"code":"E_HTTP","message":"connection refused"}}' >&2; exit 5; fi
      printf '{"runs":["run-%s-1","run-%s-2"]}\n' "$t" "$t" ;;
    bakers_comment_publish) echo '{"id":"c1","type":"comment"}' ;;
  esac
  exit 0
fi
case "$*" in
  "oven status")
    if [ -f "$CALLS.online.$name" ]; then state=online; else state=offline; fi
    printf '%s\t%s\tproject\tlabel\t%s\n' "$name" "$state" "$PWD"
    exit 0 ;;
esac
if [ -n "${BAKERS_FAIL:-}" ] && [ "$name" = "$BAKERS_FAIL" ]; then
  echo "conductor did not come online" >&2
  exit 1
fi
if [ -n "${BAKERS_STALE:-}" ] && [ "$name" = "$BAKERS_STALE" ]; then
  n=$(( $(cat "$CALLS.stale" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$CALLS.stale"
  if [ "$n" -le "${STALE_STARTS:-1}" ]; then
    echo "conductor $name already running (pid 4242, heartbeat 90s old)"
    exit 0
  fi
fi
touch "$CALLS.online.$name"
echo "started conductor $name"
EOF
chmod +x "$STUB/herdr" "$STUB/bakers"

# A home with two configured git checkouts and one plain directory. ALPHA has
# worktrees for tickets A-1 and A-2 and for a branch with no ticket; BETA has
# one for B-1; plain has one that must never be looked at.
fixture() {
  export HOME="$SCRATCH/home" CALLS="$SCRATCH/calls"
  rm -rf "$HOME" "$CALLS" "$CALLS".*
  mkdir -p "$HOME/projects/ALPHA/.bakers" "$HOME/projects/BETA/.bakers" "$HOME/projects/plain"
  touch "$HOME/projects/ALPHA/.bakers/project.config.js" "$HOME/projects/BETA/.bakers/conductor.config.js"
  repo "$HOME/projects/ALPHA" t/A-1 t/A-2 t/none
  repo "$HOME/projects/BETA" t/B-1
  repo "$HOME/projects/plain" t/P-1
  touch "$CALLS"
}

# repo DIR BRANCH...: a git checkout on main with one worktree per branch.
repo() {
  local dir="$1" b
  shift
  git -C "$dir" init -q -b main
  git -C "$dir" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
  for b in "$@"; do git -C "$dir" worktree add -q -b "$b" "$dir/.wt/${b//\//-}"; done
}

# Lines of $CALLS for one tool, in order.
tool_calls() { grep "^bakers tools $1 " "$CALLS" || true; }

run() {
  PATH="$STUB:$PATH" BAKERS_CONDUCTOR_RETRY_SECONDS=1 \
    BAKERS_CONDUCTOR_RETRY_FOR=5 BAKERS_CONDUCTOR_RETRY_LOG="$SCRATCH/retry.log" \
    bash "$SCRIPT" > "$SCRATCH/out" 2>&1 \
    || fail "exit code $? (expected 0)"
}

# --- Off ---------------------------------------------------------------------
fixture
unset BAKERS_CONDUCTOR_AUTOSTART
run
grep -qx 'conductors: autostart off' "$SCRATCH/out" || fail "unset: no off line: $(cat "$SCRATCH/out")"
if grep -v '^bakers tools ' "$CALLS" | grep -q .; then fail "unset: called more than the cancel: $(cat "$CALLS")"; fi
[ "$(tool_calls bakers_run_cancel | wc -l)" -eq 3 ] || fail "unset: expected 3 cancels: $(cat "$CALLS")"
fixture
export BAKERS_CONDUCTOR_AUTOSTART=false
run
if grep -v '^bakers tools ' "$CALLS" | grep -q .; then fail "false: called more than the cancel: $(cat "$CALLS")"; fi
[ "$(tool_calls bakers_run_cancel | wc -l)" -eq 3 ] || fail "false: expected 3 cancels: $(cat "$CALLS")"
pass "autostart off starts nothing and still cancels the box's runs"

# --- Box start cancel ---------------------------------------------------------
fixture
export BAKERS_CONDUCTOR_AUTOSTART=true
run
for t in A-1 A-2 B-1; do
  [ "$(tool_calls bakers_run_cancel | grep -c "\"ticket\":\"$t\"")" = 1 ] || fail "cancel: $t not cancelled once: $(cat "$CALLS")"
  tool_calls bakers_run_cancel | grep "\"ticket\":\"$t\"" | grep -q '"reason":"box restart"' || fail "cancel: $t reason not box restart"
  [ "$(tool_calls bakers_comment_publish | grep -c "\"ticket\":\"$t\"")" = 1 ] || fail "cancel: $t has no single comment: $(cat "$CALLS")"
  grep -qx "conductors: box restart cancelled $t (2 run(s))" "$SCRATCH/out" || fail "cancel: no line for $t: $(cat "$SCRATCH/out")"
done
tool_calls bakers_comment_publish | grep '"ticket":"A-1"' | grep '"type":"comment"' | grep -q 'run-A-1-1' \
  || fail "cancel: comment not of type comment naming the runs: $(tool_calls bakers_comment_publish)"
[ "$(tool_calls bakers_run_cancel | wc -l)" -eq 3 ] || fail "cancel: a branch without ticket was cancelled: $(cat "$CALLS")"
if tool_calls bakers_ticket_search | grep -q '"branch_name":"main"'; then fail "cancel: looked up the checkout's own branch"; fi
if tool_calls bakers_ticket_search | grep -q 'P-1'; then fail "cancel: looked at a checkout without config"; fi
last_tool=$(grep -n '^bakers tools ' "$CALLS" | tail -n 1 | cut -d: -f1)
first_start=$(grep -n '^bakers oven start' "$CALLS" | head -n 1 | cut -d: -f1)
[ "$last_tool" -lt "$first_start" ] || fail "cancel: a conductor started before the cancel finished: $(cat "$CALLS")"
if grep -q '^herdr' "$CALLS"; then fail "cancel: asked herdr"; fi
pass "a box start cancels every worktree ticket's runs once, before any conductor starts"

fixture
CANCEL_IDLE=A-1 CANCEL_FAIL=A-2 run
if tool_calls bakers_comment_publish | grep -q '"ticket":"A-[12]"'; then fail "skip: commented a ticket with nothing cancelled"; fi
if grep -q 'A-1' "$SCRATCH/out"; then fail "skip: idle ticket not skipped quietly: $(cat "$SCRATCH/out")"; fi
grep -q "^conductors: box restart cancel failed t/A-2: .*connection refused" "$SCRATCH/out" || fail "skip: failure not logged with its branch: $(cat "$SCRATCH/out")"
grep -qx "conductors: box restart cancelled B-1 (2 run(s))" "$SCRATCH/out" || fail "skip: B-1 not cancelled after a failure"
[ "$(grep -c '^bakers oven start' "$CALLS")" = 2 ] || fail "skip: conductors not started after a failed cancel"
pass "no active run is skipped quietly, a failed cancel is logged and the start goes on"

# --- On ----------------------------------------------------------------------
fixture
export BAKERS_CONDUCTOR_AUTOSTART=true
run
[ "$(grep -c '^bakers oven start' "$CALLS")" = 2 ] || fail "on: expected 2 starts: $(cat "$CALLS")"
grep -q "^bakers oven start --no-update-check @ $HOME/projects/ALPHA$" "$CALLS" || fail "on: ALPHA not started from its checkout"
grep -q "^bakers oven start --no-update-check @ $HOME/projects/BETA$" "$CALLS" || fail "on: BETA not started from its checkout"
if grep -q "@ $HOME/projects/plain$" "$CALLS"; then fail "on: started a directory without config"; fi
grep -qx "conductors: started $HOME/projects/ALPHA" "$SCRATCH/out" || fail "on: no started line: $(cat "$SCRATCH/out")"
pass "autostart on starts every configured checkout"

# --- A failing checkout ------------------------------------------------------
fixture
BAKERS_FAIL=ALPHA run
grep -q "^conductors: failed $HOME/projects/ALPHA: conductor did not come online$" "$SCRATCH/out" \
  || fail "failure not named: $(cat "$SCRATCH/out")"
grep -qx "conductors: started $HOME/projects/BETA" "$SCRATCH/out" || fail "BETA not started after ALPHA failed"
pass "a failing checkout is named and the others start"

# --- herdr down -------------------------------------------------------------
# `bakers oven start` runs the conductor detached, so it does not wait for herdr.
fixture
HERDR_DOWN=1 run
[ "$(grep -c '^bakers oven start' "$CALLS")" = 2 ] || fail "herdr down: expected 2 starts: $(cat "$CALLS")"
if grep -q '^herdr' "$CALLS"; then fail "herdr down: waited for herdr"; fi
pass "conductors start without waiting for herdr"

# --- A stale "already running" after a hard stop -----------------------------
fixture
rm -f "$SCRATCH/retry.log"
BAKERS_STALE=ALPHA STALE_STARTS=2 run
grep -q "^conductors: waiting $HOME/projects/ALPHA: conductor ALPHA already running" "$SCRATCH/out" \
  || fail "stale: no waiting line: $(cat "$SCRATCH/out")"
grep -qx "conductors: started $HOME/projects/BETA" "$SCRATCH/out" || fail "stale: BETA not started"
for _ in $(seq 1 10); do
  grep -qx "conductors: started $HOME/projects/ALPHA" "$SCRATCH/retry.log" 2>/dev/null && break
  sleep 1
done
grep -qx "conductors: started $HOME/projects/ALPHA" "$SCRATCH/retry.log" \
  || fail "stale: not retried until online: $(cat "$SCRATCH/retry.log" 2>/dev/null)"
[ "$(grep -c "^bakers oven start --no-update-check @ $HOME/projects/ALPHA$" "$CALLS")" = 3 ] \
  || fail "stale: expected 3 starts of ALPHA: $(cat "$CALLS")"
pass "a stale start is retried in the background until online"

echo "OK: conductor autostart contract holds"
