#!/bin/sh
# spiceedit herdr plugin — the `open-overlay` action (keybinding fallback).
#
# The intended trigger for the click-to-edit overlay is hunk's file-activate hook
# firing this with the selected file. hunk's hook surface is an OPEN DEPENDENCY on
# BB-55 (see conductor/README.md § review), so this action is the fallback: bind
# it to a herdr key and it opens the `edit` overlay for $SPICEEDIT_FILE.
#
# It resolves the target path, then asks herdr to open the spiceedit overlay:
#   herdr plugin pane open --plugin spiceedit --entrypoint edit --placement overlay \
#     --env SPICEEDIT_FILE="<path>" --focus
# Everything is best-effort + guarded: a missing path or herdr just prints a message.
set -eu

HERDR_BIN="${HERDR_BIN_PATH:-herdr}"

FILE="${SPICEEDIT_FILE:-${HERDR_FILE:-${1:-}}}"

if [ -z "$FILE" ]; then
  printf 'spiceedit overlay: no file to open (set SPICEEDIT_FILE).\n' >&2
  printf 'This action is the fallback for hunk file-activate; see conductor/README.md.\n' >&2
  exit 0
fi

exec "$HERDR_BIN" plugin pane open \
  --plugin spiceedit \
  --entrypoint edit \
  --placement overlay \
  --env "SPICEEDIT_FILE=$FILE" \
  --focus
