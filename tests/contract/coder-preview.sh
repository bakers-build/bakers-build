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
#   - an unmarked addon-ports entry or tunnel key wins over the parameter; a
#     nested tunnel key or a commented-out ports entry does not
#   - a created addons key goes again at none, and the file mode stays; a
#     hand addon added inside that list keeps it
#   - a multi-line template literal or quoted keys still give one addons key
#     holding the Quick entry
#   - keys are found in code only: an addons key sharing its line gets the
#     entry, addons or tunnel inside a comment or string is ignored, and a
#     shorthand addons key gets a log line instead of a second key
#   - keys of a helper object above the export are ignored; a stray quote in a
#     template, regex or before a later quoted comment gives a log line and no
#     change, never a second, shadowed addons or tunnel key
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

# A tunnel key nested in an addon's options is not the machine's tunnel.
sed 's#^  { use: .@bakers-build/addon-ddev.*#  { use: "@bakers-build/addon-ddev", with: {\n   tunnel: 1,\n  } },#' "$SCRATCH/hand.js" > "$M"
edit cloudflare-quick
[ "$(tunnel_value)" = true ] || fail "nested tunnel key: tunnel is $(tunnel_value)"
[ "$(ports_entries)" = 1 ] || fail "nested tunnel key: $(ports_entries) addon-ports entries"
pass "a nested tunnel key does not stop the marked tunnel line"

sed 's#^ label: "box",$# label: "box",\n tunnel: true,#' "$SCRATCH/hand.js" > "$SCRATCH/own-tunnel.js"
cp "$SCRATCH/own-tunnel.js" "$M"
edit cloudflare-quick
[ "$(grep -c 'tunnel:' "$M")" = 1 ] || fail "a hand tunnel key got a duplicate: $(cat "$M")"
grep -qi 'sets tunnel itself' "$OUT" || fail "the hand tunnel key is not named: $(cat "$OUT")"
[ "$(ports_entries)" = 1 ] || fail "hand tunnel key: $(ports_entries) addon-ports entries"
pass "a hand top-level tunnel key wins, with no duplicate"

sed 's#^  // my own addon$#  // { use: "@bakers-build/addon-ports" },\n  /* { use: "@bakers-build/addon-ports" }, */#' "$SCRATCH/hand.js" > "$M"
edit cloudflare-quick
[ "$(ports_entries)" = 1 ] || fail "a commented-out ports entry stopped the Quick entry: $(cat "$OUT")"
pass "a commented-out addon-ports entry does not count as a hand entry"

printf '// @bakers-schema-version 1\nexport default {\n machine_id: "x",\n};\n' > "$SCRATCH/bare.js"
cp "$SCRATCH/bare.js" "$M"
chmod 600 "$M"
edit cloudflare-quick
[ "$(ports_entries)" = 1 ] || fail "no addons key: $(ports_entries) addon-ports entries"
[ "$(stat -c %a "$M" 2>/dev/null || stat -f %Lp "$M")" = 600 ] || fail "the edit changed the file mode"
edit none
cmp -s "$M" "$SCRATCH/bare.js" || fail "none did not restore a file without addons: $(diff "$SCRATCH/bare.js" "$M")"
pass "a created addons key goes again at none, and the file mode stays"

# An addon added by hand inside the created list keeps that list.
edit cloudflare-quick
sed "s#^ addons: \[\$# addons: [\n  { use: '@acme/hand' },#" "$M" > "$SCRATCH/h1" && cp "$SCRATCH/h1" "$M"
edit cloudflare-quick
exported | grep -q '@acme/hand' || fail "a hand addon in the created list is gone: $(cat "$M")"
[ "$(ports_entries)" = 1 ] || fail "hand addon in the created list: $(ports_entries) addon-ports entries"
edit none
exported | grep -q '@acme/hand' || fail "none removed a hand addon in the created list: $(cat "$M")"
[ "$(ports_entries)" = 0 ] || fail "none kept the Quick entry next to a hand addon"
pass "a hand addon inside the created addons list survives cloudflare-quick and none"

# One addons key holding the Quick entry, whatever comes before it or how keys are quoted.
one_addons() {
  [ "$(grep -cE "^\s*[\"']?addons[\"']?\s*:" "$M")" = 1 ] || fail "$1: not exactly one addons key: $(cat "$M")"
  [ "$(ports_entries)" = 1 ] || fail "$1: $(ports_entries) addon-ports entries"
  exported | grep -q 'addon-ddev' || fail "$1: the hand addon is gone"
}
printf '%s\n' '// @bakers-schema-version 1' 'export default {' ' label: `two' 'lines`,' ' addons: [' "  { use: '@bakers-build/addon-ddev' }," ' ],' '};' > "$M"
edit cloudflare-quick
one_addons "a multi-line template literal before addons"
printf '%s\n' '// @bakers-schema-version 1' 'export default {' ' "tunnel": true,' ' "addons": [' "  { use: '@bakers-build/addon-ddev' }," ' ],' '};' > "$M"
edit cloudflare-quick
one_addons "quoted keys"
[ "$(grep -c 'tunnel' "$M")" = 1 ] || fail "a quoted hand tunnel key got a duplicate: $(cat "$M")"
pass "a template literal or quoted keys before the list leave one addons key with the Quick entry"

# Keys are found in code only: not in comments or strings, and not only at the start of a line.
quick_with_hand() {
  [ "$(ports_entries)" = 1 ] || fail "$1: $(ports_entries) addon-ports entries: $(cat "$M")"
  exported | grep -q 'addon-ddev' || fail "$1: the hand addon is gone: $(cat "$M")"
}
printf '%s\n' '// @bakers-schema-version 1' 'export default {' ' machine_id: "m1", addons: [' "  { use: '@bakers-build/addon-ddev' }," ' ],' '};' > "$M"
edit cloudflare-quick
quick_with_hand "an addons key sharing its line"
printf '%s\n' '// @bakers-schema-version 1' 'export default {' ' /*' ' addons: [' ' */' ' addons: [' "  { use: '@bakers-build/addon-ddev' }," ' ],' '};' > "$M"
edit cloudflare-quick
quick_with_hand "an addons line in a block comment"
printf '%s\n' '// @bakers-schema-version 1' 'export default {' ' label: `x' ' addons: [' ' `,' ' addons: [' "  { use: '@bakers-build/addon-ddev' }," ' ],' '};' > "$M"
edit cloudflare-quick
quick_with_hand "an addons line in a template literal"
exported | grep -q '"label":"x\\n addons: \[\\n "' || fail "the template literal changed: $(cat "$M")"
printf '%s\n' '// @bakers-schema-version 1' 'export default {' ' /*' ' tunnel: true,' ' */' '};' > "$M"
edit cloudflare-quick
[ "$(tunnel_value)" = true ] || fail "tunnel in a block comment: tunnel is $(tunnel_value)"
grep -qi 'sets tunnel itself' "$OUT" && fail "a commented-out tunnel key is named as the machine's: $(cat "$OUT")"
printf '%s\n' '// @bakers-schema-version 1' "const addons = [{ use: '@bakers-build/addon-ddev' }];" 'export default {' ' addons,' '};' > "$M"
edit cloudflare-quick
[ "$(grep -c 'addons' "$M")" = 2 ] || fail "shorthand addons: a second addons key: $(cat "$M")"
grep -qi 'cannot place' "$OUT" || fail "shorthand addons: no log line: $(cat "$OUT")"
[ "$(tunnel_value)" = true ] || fail "shorthand addons: tunnel is $(tunnel_value)"
pass "keys sharing a line, in comments or strings, or in shorthand are found or named"

# Only keys of the exported object count; a scan the script cannot follow leaves the file alone.
printf '%s\n' '// @bakers-schema-version 1' 'const defaults = { tunnel: false, addons: [] };' 'const more = {' ' tunnel: false,' ' addons: [' ' ],' '};' 'export default {' ' addons: [' "  { use: '@bakers-build/addon-ddev' }," ' ],' '};' > "$M"
edit cloudflare-quick
[ "$(tunnel_value)" = true ] || fail "tunnel in a helper const: tunnel is $(tunnel_value): $(cat "$M")"
grep -qi 'sets tunnel itself' "$OUT" && fail "a helper const's tunnel is named as the machine's: $(cat "$OUT")"
quick_with_hand "addons in a helper const"
printf '%s\n' '// @bakers-schema-version 1' 'export default {' ' tpl: `a${"`"}b`,' ' addons: [' "  { use: '@bakers-build/addon-ddev' }," ' ],' '};' > "$M"
cp "$M" "$SCRATCH/nested"
edit cloudflare-quick
if ! cmp -s "$M" "$SCRATCH/nested"; then
  quick_with_hand "a backtick nested in a template literal"
  [ "$(grep -cE "^\s*addons\s*:" "$M")" = 1 ] || fail "a nested backtick: not exactly one addons key: $(cat "$M")"
else
  grep -qi 'cannot read' "$OUT" || fail "a nested backtick left the file unchanged without a log line: $(cat "$OUT")"
fi
# A stray quote that a later quote in a comment closes: one key holding the entry, or the log and no change.
unreadable_or_one() {
  if cmp -s "$M" "$SCRATCH/lost"; then
    grep -qi 'cannot read' "$OUT" || fail "$1: unchanged without a log line: $(cat "$OUT")"
  else
    [ "$(grep -cE "^\s*$2\s*:" "$M")" = 1 ] || fail "$1: not exactly one $2 key: $(cat "$M")"
    quick_with_hand "$1"
  fi
}
for stray in ' tpl: `a${"`"}b`,|// the 27" screen box' " re: /it's/,|// it's fine"; do
  printf '%s\n' '// @bakers-schema-version 1' 'export default {' " ${stray%%|*}" ' addons: [' "  { use: '@bakers-build/addon-ddev' }," ' ],' " ${stray#*|}" '};' > "$M"
  cp "$M" "$SCRATCH/lost"
  edit cloudflare-quick
  unreadable_or_one "a stray quote closed in a later comment (${stray%%|*})" addons
done
printf '%s\n' '// @bakers-schema-version 1' 'export default {' ' tpl: `a${"`"}b`,' ' tunnel: false,' ' addons: [' "  { use: '@bakers-build/addon-ddev' }," ' ],' ' // the 27" screen box' '};' > "$M"
cp "$M" "$SCRATCH/lost"
edit cloudflare-quick
unreadable_or_one "a stray quote hiding a hand tunnel key" tunnel
pass "keys of a helper const are ignored, and an unreadable file is named and left unchanged"

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
