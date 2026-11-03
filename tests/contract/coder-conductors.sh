#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Behaviour of the bakers-ddev template's conductor autostart
# (coder/bakers-ddev/scripts/conductors.sh), with herdr and bakers stubs on
# PATH and a temporary HOME. Nothing real starts.
#
#   bash tests/contract/coder-conductors.sh
#
# Asserts:
#   - autostart off (unset or false): one "off" line, no herdr or bakers call
#   - on: every ~/projects/* checkout with .bakers/conductor.config.js gets one
#     `bakers oven start` run from inside it; a directory without one does not
#   - a failing start is named with its path and the others still start
#   - herdr never ready: one skip line, no start
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
# BAKERS_STALE names a checkout whose first STALE_STARTS starts only say
# "already running" (exit 0) and leave it offline, as after a hard stop.
cat > "$STUB/bakers" <<'EOF'
#!/usr/bin/env bash
printf 'bakers %s @ %s\n' "$*" "$PWD" >> "$CALLS"
name="$(basename "$PWD")"
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

# A home with two configured checkouts and one plain directory.
fixture() {
  export HOME="$SCRATCH/home" CALLS="$SCRATCH/calls"
  rm -rf "$HOME" "$CALLS" "$CALLS".*
  mkdir -p "$HOME/projects/ALPHA/.bakers" "$HOME/projects/BETA/.bakers" "$HOME/projects/plain"
  touch "$HOME/projects/ALPHA/.bakers/conductor.config.js" "$HOME/projects/BETA/.bakers/conductor.config.js"
  touch "$CALLS"
}

run() {
  PATH="$STUB:$PATH" BAKERS_CONDUCTOR_WAIT=2 BAKERS_CONDUCTOR_RETRY_SECONDS=1 \
    BAKERS_CONDUCTOR_RETRY_FOR=5 BAKERS_CONDUCTOR_RETRY_LOG="$SCRATCH/retry.log" \
    bash "$SCRIPT" > "$SCRATCH/out" 2>&1 \
    || fail "exit code $? (expected 0)"
}

# --- Off ---------------------------------------------------------------------
fixture
unset BAKERS_CONDUCTOR_AUTOSTART
run
grep -qx 'conductors: autostart off' "$SCRATCH/out" || fail "unset: no off line: $(cat "$SCRATCH/out")"
[ ! -s "$CALLS" ] || fail "unset: called $(cat "$CALLS")"
export BAKERS_CONDUCTOR_AUTOSTART=false
run
[ ! -s "$CALLS" ] || fail "false: called $(cat "$CALLS")"
pass "autostart off starts nothing"

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

# --- herdr never ready -------------------------------------------------------
fixture
HERDR_DOWN=1 run
grep -qx 'conductors: skipped: herdr server not ready' "$SCRATCH/out" || fail "herdr down: $(cat "$SCRATCH/out")"
if grep -q '^bakers' "$CALLS"; then fail "herdr down: started a conductor"; fi
pass "no start without a herdr server"

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
