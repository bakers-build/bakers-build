#!/usr/bin/env bash
# Preview links over FRP (README › Previews): with BOX_FRP_ENROLLMENT set, frp-config.mjs writes
# frpc's config from it, then frpc starts detached and the last line names the zone:
#   frp: configured for <zone>
# install.sh hands that zone to machine-config.mjs for the ports entry. Without an enrollment FRP
# is off. It never fails the workspace start.
set -uo pipefail

if [ -z "${BOX_FRP_ENROLLMENT:-}" ]; then
  echo "frp: off (no enrollment)"
  exit 0
fi
# stdout only: a Node warning must not become the zone. Errors reach the startup log on stderr.
if ! zone=$(BOX_FRP_ENROLLMENT=$BOX_FRP_ENROLLMENT node "$(dirname "$0")/frp-config.mjs"); then
  exit 0
fi
# The container's /tmp and processes live for one start, so no earlier frpc runs here.
nohup frpc -c "$HOME/.config/frp/frpc.json" >"${TMPDIR:-/tmp}/frpc.log" 2>&1 </dev/null &
echo "frp: configured for $zone"
exit 0
