# Test helpers, sourced by tests/*.test.sh. Each test gets a fresh HOME and a bin directory of
# fake commands that log their argv to $CALLS and their stdin to $STDIN_LOG.
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
FAILED=0

setup() {
  ROOT=$(mktemp -d)
  export HOME="$ROOT/home" CALLS="$ROOT/calls" STDIN_LOG="$ROOT/stdin" FAKE_BIN="$ROOT/bin"
  mkdir -p "$HOME" "$FAKE_BIN"
  : >"$CALLS"
  : >"$STDIN_LOG"
  export PATH="$FAKE_BIN:$ORIGINAL_PATH"
  export TMPDIR="$ROOT/tmp"
  mkdir -p "$TMPDIR"
}
ORIGINAL_PATH="$PATH"

# fake NAME [BODY]: a command that logs "NAME argv" and its stdin (when not a terminal), then runs BODY.
fake() {
  cat >"$FAKE_BIN/$1" <<EOF
#!/usr/bin/env bash
echo "$1 \$*" >>"\$CALLS"
if [ ! -t 0 ]; then in=\$(cat); [ -z "\$in" ] || echo "$1: \$in" >>"\$STDIN_LOG"; fi
${2:-}
EOF
  chmod +x "$FAKE_BIN/$1"
}

pass() { echo "ok   $1"; }
fail() {
  echo "FAIL $1"
  FAILED=1
}
check() { # check NAME COMMAND...: passes when the command succeeds
  local name=$1
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}
has() { grep -qF -- "$2" "$1"; }
lacks() { ! grep -qrF -- "$2" "$1"; }
mode() { ls -l "$1" | cut -c1-10; }
# age FILE SECONDS: set FILE's mtime SECONDS in the past
age() { node -e 'const fs=require("fs");const t=Date.now()/1000-Number(process.argv[2]);fs.utimesSync(process.argv[1],t,t)' "$1" "$2"; }

finish() { exit "$FAILED"; }
