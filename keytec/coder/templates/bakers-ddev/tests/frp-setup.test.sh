#!/usr/bin/env bash
# frp-setup.sh: the FRP enrollment string becomes frpc.json, a routes file and a running frpc (AC-4, AC-11).
source "$(dirname "$0")/lib.sh"

# addon-ports-frp's validator (src/frp.ts, imported with Node's type stripping), or PORTS_FRP_JS after the move to keytec/infra.
PORTS_FRP="${PORTS_FRP_JS:-$(cd "$(dirname "$0")/../../../../.." && pwd)/bakers-cli/addons/ports-frp/src/frp.ts}"
enroll() { printf 'bkfrp1.%s' "$(printf '%s' "$1" | base64 | tr -d '=\n' | tr '+/' '-_')"; }
GOOD=$(enroll '{"server":"frps.preview.example","port":7000,"zone":"frps.preview.example","user":"box-1","token":"frp-test-token-444"}')
CFG() { echo "$HOME/.config/frp/frpc.json"; }

# A valid enrollment: frpc.json in the shape addon-ports-frp accepts, private files, frpc started.
setup
fake frpc
BOX_FRP_ENROLLMENT=$GOOD bash "$SCRIPTS/frp-setup.sh" >"$ROOT/out"
check "frpc.json written" test -f "$(CFG)"
check "frpc.json private" test "$(mode "$(CFG)")" = "-rw-------"
check "admin password private" test "$(mode "$HOME/.config/frp/admin-password")" = "-rw-------"
check "routes file seeded empty" test "$(cat "$HOME/.bakers/frp/routes.json")" = '{"proxies":[]}'
check "prints the zone" has "$ROOT/out" "frp: configured for frps.preview.example"
if [ -f "$PORTS_FRP" ]; then
  check "addon-ports-frp accepts the client config" node --input-type=module -e "
    import { validateClientConfig } from '$PORTS_FRP';
    import { readFileSync } from 'node:fs';
    validateClientConfig(JSON.parse(readFileSync('$(CFG)', 'utf8')), '$HOME/.bakers/frp/routes.json');"
else
  echo "skip addon-ports-frp accepts the client config ($PORTS_FRP missing; set PORTS_FRP_JS)"
fi
check "server, user and token from the enrollment" node -e "
  const c = JSON.parse(require('fs').readFileSync('$(CFG)', 'utf8'));
  process.exit(c.serverAddr === 'frps.preview.example' && c.serverPort === 7000 && c.user === 'box-1'
    && c.auth.method === 'token' && c.auth.token === 'frp-test-token-444' ? 0 : 1)"
for _ in $(seq 20); do grep -q '^frpc' "$CALLS" && break; sleep 0.1; done # frpc runs detached
check "frpc started with the config" has "$CALLS" "frpc -c $(CFG)"
check "token not in argv" lacks "$CALLS" frp-test-token
check "token not in the log" lacks "$ROOT/out" frp-test-token

# A second run keeps the admin password.
pw=$(cat "$HOME/.config/frp/admin-password")
BOX_FRP_ENROLLMENT=$GOOD bash "$SCRIPTS/frp-setup.sh" >"$ROOT/out"
check "admin password created once" test "$(cat "$HOME/.config/frp/admin-password")" = "$pw"

# A malformed enrollment writes nothing and starts nothing.
for bad in 'bkfrp1.not-base64!' "$(enroll '{"server":"x"}')" 'other.abc'; do
  setup
  fake frpc
  BOX_FRP_ENROLLMENT=$bad bash "$SCRIPTS/frp-setup.sh" >"$ROOT/out"
  check "malformed '$bad': exit 0" test $? -eq 0
  check "malformed '$bad': nothing written" test ! -e "$HOME/.config/frp" -a ! -e "$HOME/.bakers"
  check "malformed '$bad': frpc not started" test ! -s "$CALLS"
  check "malformed '$bad': logged" has "$ROOT/out" "frp: enrollment malformed"
done

# No enrollment: off.
setup
fake frpc
bash "$SCRIPTS/frp-setup.sh" >"$ROOT/out"
check "no enrollment: frp off" has "$ROOT/out" "frp: off"
check "no enrollment: nothing written" test ! -e "$HOME/.config/frp"

finish
