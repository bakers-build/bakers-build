#!/bin/sh
# spiceedit herdr plugin — the `edit` overlay entrypoint.
#
# Runs inside the herdr overlay pane opened by
#   herdr plugin pane open --plugin spiceedit --entrypoint edit --placement overlay \
#     --env SPICEEDIT_FILE="<path>" --focus
# and execs `spiceedit "$FILE"` on the file the caller selected (e.g. the changed
# file activated in the hunk review pane).
#
# Graceful degradation (BB-58 AC): an absent spiceedit or an unset path never
# crashes — it prints a message and closes cleanly, so a review run keeps working.
set -eu

# The invoker passes the path via --env SPICEEDIT_FILE=<path>. Accept a couple of
# aliases + a positional arg so a keybinding/hook can use whichever it has.
FILE="${SPICEEDIT_FILE:-${HERDR_FILE:-${1:-}}}"

pause_if_tty() {
  # Keep a message readable instead of the overlay flashing shut.
  if [ -t 0 ]; then
    printf '\nPress Enter to close…' >&2
    read -r _ || true
  fi
}

if ! command -v spiceedit >/dev/null 2>&1; then
  printf 'spiceedit is not installed — the click-to-edit overlay is unavailable.\n' >&2
  printf 'Install it via the conductor bootstrap (bakers-cli/scripts/setup.sh); needs Go 1.22+.\n' >&2
  pause_if_tty
  exit 0
fi

if [ -z "$FILE" ]; then
  printf 'No file supplied — set SPICEEDIT_FILE (e.g. --env SPICEEDIT_FILE=<path>).\n' >&2
  pause_if_tty
  exit 0
fi

exec spiceedit "$FILE"
