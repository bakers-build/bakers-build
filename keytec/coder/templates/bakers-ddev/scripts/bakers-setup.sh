#!/usr/bin/env bash
# Signs the workspace in to bakers.build with its OAuth client (README › bakers.build sign-in), once:
# without ~/.bakers/bakers.config.js it runs `bakers init` with client credentials, which writes the
# connection (secret included, file mode 0600) and the machine identity, then `bakers auth login`.
# The secret reaches bakers through the environment only. It never fails the workspace start.
set -uo pipefail

if [ -f "$HOME/.bakers/bakers.config.js" ]; then
  echo "bakers: connection exists"
  exit 0
fi
if [ -z "${BAKERS_CLIENT_ID:-}" ] || [ -z "${BAKERS_CLIENT_SECRET:-}" ]; then
  echo "bakers: skipped (no OAuth client)"
  exit 0
fi

export BAKERS_CLIENT_SECRET
if bakers init --base-url "$BAKERS_URL" --auth-type client_credentials --client-id "$BAKERS_CLIENT_ID" \
  --secret-env BAKERS_CLIENT_SECRET --label "${WORKSPACE_NAME:-$(hostname -s)}" --yes >/dev/null 2>&1 &&
  bakers auth login >/dev/null 2>&1; then
  echo "bakers: signed in to $BAKERS_URL"
else
  echo "bakers: sign-in failed; run bakers init by hand (README › bakers.build sign-in)"
fi
exit 0
