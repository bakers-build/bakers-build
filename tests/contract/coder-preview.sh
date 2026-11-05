#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Behaviour of the bakers-ddev template's preview transport parameter:
# the machine-file edit (coder/bakers-ddev/scripts/preview-config.mjs) and the
# client selection in the start script (coder/bakers-ddev/scripts/install.sh),
# with stubbed binaries on PATH. Nothing real is downloaded or started.
#
#   bash tests/contract/coder-preview.sh     (bash 5, node 22+)
#
# Asserts:
#   - no machine file + cloudflare-quick: the file is created; it imports
#     with tunnel === true and exactly one addon-ports entry
#   - every byte outside the marked lines stays, a second run changes nothing,
#     and none restores the original byte for byte
#   - frp keeps the marked tunnel line, drops the Cloudflare Quick block and
#     names the missing operator ports entry
#   - an unmarked addon-ports entry or tunnel key wins over the parameter
#   - a broken machine file stays untouched, with exit 0 and a log line
#   - install.sh: none starts and installs nothing even with the token file and
#     frpc.json present; cloudflare-quick installs cloudflared and starts no
#     connector; cloudflare and frp install their client and start it only
#     when the operator file exists
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/coder/bakers-ddev/scripts/preview-config.mjs"
INSTALL="$REPO_ROOT/coder/bakers-ddev/scripts/install.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

[ -f "$SCRIPT" ] || fail "missing $SCRIPT"

# Runs the script on $M; its output lands in $OUT.
M="$SCRATCH/home/.bakers/machine.config.js"
OUT="$SCRATCH/out"
edit() { node "$SCRIPT" "$1" "$M" >"$OUT" 2>&1 || fail "exit $? for $1: $(cat "$OUT")"; }
# The default export as JSON, read the way the conductor reads it.
exported() { node --input-type=module -e "const m = await import(process.argv[1] + '?t=' + Date.now()); console.log(JSON.stringify(m.default))" "file://$M"; }
ports_entries() { exported | node -e "const c = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log((c.addons ?? []).filter((a) => a.use === '@bakers-build/addon-ports').length)"; }
tunnel_value() { exported | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).tunnel)"; }

# --- F1: created from nothing ----------------------------------------------
edit cloudflare-quick
[ -f "$M" ] || fail "cloudflare-quick did not create the machine file"
[ "$(tunnel_value)" = true ] || fail "created file: tunnel is $(tunnel_value)"
[ "$(ports_entries)" = 1 ] || fail "created file: $(ports_entries) addon-ports entries"
exported | grep -q 'addon-ports-cloudflare-quick' || fail "created file: no Cloudflare Quick transport"
pass "a missing machine file is created with tunnel and the Cloudflare Quick entry"

# --- F2, F3: hand entries survive, runs are idempotent, none restores --------
cat > "$SCRATCH/hand.js" <<'EOF'
// @bakers-schema-version 1
// Local host identity.
export default {
 schema_version: 1,
 machine_id: "4b0c5f0e-1d7a-4f39-9a51-6b2d1f3e8c11",
 label: "box",
 agents: { addons: [] },
 addons: [
  // my own addon
  { use: '@bakers-build/addon-ddev', with: { apiToken: process.env.X } },
 ],
};
EOF
cp "$SCRATCH/hand.js" "$M"
edit cloudflare-quick
[ "$(tunnel_value)" = true ] || fail "hand file: tunnel is $(tunnel_value)"
[ "$(ports_entries)" = 1 ] || fail "hand file: $(ports_entries) addon-ports entries"
exported | grep -q 'addon-ddev' || fail "hand file: the hand addon is gone"
grep -v 'bakers-ddev preview' "$M" | grep -v 'addon-ports-cloudflare-quick' > "$SCRATCH/rest" || true
cmp -s "$SCRATCH/rest" "$SCRATCH/hand.js" || fail "bytes outside the markers changed: $(diff "$SCRATCH/hand.js" "$SCRATCH/rest")"
cp "$M" "$SCRATCH/once"
edit cloudflare-quick
cmp -s "$M" "$SCRATCH/once" || fail "a second cloudflare-quick run changed the file"
pass "hand entries stay byte for byte and a second run changes nothing"

edit none
cmp -s "$M" "$SCRATCH/hand.js" || fail "none did not restore the original: $(diff "$SCRATCH/hand.js" "$M")"
[ "$(tunnel_value)" = undefined ] || fail "none: tunnel is $(tunnel_value)"
pass "none removes exactly what the parameter wrote"

edit cloudflare-quick
edit frp
[ "$(tunnel_value)" = true ] || fail "frp: tunnel is $(tunnel_value)"
[ "$(ports_entries)" = 0 ] || fail "frp kept the Cloudflare Quick entry"
grep -qi 'ports entry' "$OUT" || fail "frp: the missing operator ports entry is not named: $(cat "$OUT")"
pass "frp keeps tunnel, drops the Quick block and names the missing ports entry"

# --- F4: an unmarked ports entry or tunnel key wins ---------------------------
sed 's#^ addons: \[$# tunnel: false,\n addons: [\n  { use: "@bakers-build/addon-ports", with: { transport: { use: "@bakers-build/addon-ports-frp" } } },#' "$SCRATCH/hand.js" > "$SCRATCH/own.js"
cp "$SCRATCH/own.js" "$M"
edit cloudflare-quick
cmp -s "$M" "$SCRATCH/own.js" || fail "an unmarked entry was overridden: $(diff "$SCRATCH/own.js" "$M")"
grep -qi 'addon-ports' "$OUT" || fail "the existing ports entry is not named: $(cat "$OUT")"
grep -qi 'tunnel' "$OUT" || fail "the existing tunnel key is not named: $(cat "$OUT")"
pass "an unmarked addon-ports entry and tunnel key win"

# --- F5: a broken file stays untouched -------------------------------------
printf 'export default {\n machine_id: "x",\n' > "$M"
cp "$M" "$SCRATCH/broken"
edit cloudflare-quick
cmp -s "$M" "$SCRATCH/broken" || fail "a broken machine file was changed"
[ -s "$OUT" ] || fail "a broken machine file left no log line"
pass "a broken machine file stays untouched, exit 0"

# --- F6: client selection in install.sh ------------------------------------
# Every tool install.sh checks for is a stub, so only the preview section acts.
# curl and nohup record their arguments; curl writes an executable or a tarball.
STUB="$SCRATCH/stub"
CALLS="$SCRATCH/calls"
export CALLS
mkdir -p "$STUB"
for tool in ss bakers herdr claude codex cursor-agent gh glab; do
  printf '#!/bin/sh\nexit 0\n' > "$STUB/$tool"
done
printf '#!/bin/sh\nexec "$@"\n' > "$STUB/setsid"
printf '#!/bin/sh\necho "nohup $1" >> "$CALLS"\n' > "$STUB/nohup"
mkdir -p "$SCRATCH/frp/frp_0.68.0_linux_amd64"
printf '#!/bin/sh\n' > "$SCRATCH/frp/frp_0.68.0_linux_amd64/frpc"
tar -czf "$SCRATCH/frp.tgz" -C "$SCRATCH/frp" .
cat > "$STUB/curl" <<EOF
#!/usr/bin/env bash
echo "curl \$*" >> "\$CALLS"
while [ \$# -gt 0 ]; do [ "\$1" = -o ] && { printf '#!/bin/sh\n' > "\$2"; exit 0; }; shift; done
cat "$SCRATCH/frp.tgz"
EOF
chmod +x "$STUB"/*
sed "s#/usr/local/bin/bakers-preview-config#$SCRIPT#; s#/usr/local/bin/pm-bot#/dev/null#" "$INSTALL" > "$SCRATCH/install.sh"

# start <transport> <with files: yes|no>: a fresh home, then install.sh.
start() {
  local home="$SCRATCH/h-$1-$2"
  rm -rf "$home" && mkdir -p "$home"
  : > "$CALLS"
  if [ "$2" = yes ]; then
    mkdir -p "$home/.cloudflared" "$home/.config/frp"
    echo token > "$home/.cloudflared/tunnel-token"
    echo '{}' > "$home/.config/frp/frpc.json"
  fi
  HOME="$home" PATH="$STUB:/usr/bin:/bin:$(dirname "$(command -v node)")" TMPDIR="$home" \
    PREVIEW_TRANSPORT="$1" CLOUDFLARED_VERSION=2026.10.2 FRP_VERSION=0.68.0 \
    bash "$SCRATCH/install.sh" >"$OUT" 2>&1 || fail "install.sh exit $? for $1: $(cat "$OUT")"
  # Detached starts land after the script exits: wait for herdr's, started before the tunnels'.
  for _ in $(seq 30); do grep -q '^nohup herdr' "$CALLS" && break; sleep 0.1; done
  sleep 0.3
}
installed() { grep -q "curl.*$1" "$CALLS"; }
started() { grep -q "^nohup $1" "$CALLS"; }

start none yes
installed cloudflared && fail "none installed cloudflared"
installed frp && fail "none installed frpc"
started cloudflared && fail "none started cloudflared"
started frpc && fail "none started frpc"
pass "none installs and starts no tunnel client, even with the operator files"

start cloudflare-quick no
installed cloudflared || fail "cloudflare-quick did not install cloudflared: $(cat "$CALLS")"
started cloudflared && fail "cloudflare-quick started a named connector"
pass "cloudflare-quick installs cloudflared and starts no connector"

start cloudflare no
installed cloudflared || fail "cloudflare did not install cloudflared"
started cloudflared && fail "cloudflare started without a tunnel token"
start cloudflare yes
started cloudflared || fail "cloudflare with a token did not start cloudflared: $(cat "$CALLS")"
started frpc && fail "cloudflare started frpc"
pass "cloudflare starts its connector only with the token file"

start frp no
installed frp || fail "frp did not install frpc"
started frpc && fail "frp started without frpc.json"
start frp yes
started frpc || fail "frp with frpc.json did not start frpc: $(cat "$CALLS")"
started cloudflared && fail "frp started cloudflared"
pass "frp starts frpc only with frpc.json"

echo "coder-preview: all passed"
