#!/usr/bin/env bash
# machine-config.mjs: the entries of ~/.bakers/machine.config.js the template owns (AC-1, AC-4, AC-5).
source "$(dirname "$0")/lib.sh"

# load FILE: the config's default export as JSON
load() { node --input-type=module -e 'const m = await import(process.argv[1]); console.log(JSON.stringify(m.default));' "$1"; }
q() { node -e 'const c=JSON.parse(process.argv[1]); console.log(String(eval("c"+process.argv[2])))' "$(load "$M")" "$1"; }

frpc_json() {
  mkdir -p "$HOME/.config/frp"
  printf '{"webServer":{"addr":"127.0.0.1","port":7400,"user":"admin","password":"pw-local"}}' >"$HOME/.config/frp/frpc.json"
}

# Missing file: created with an ID, the label and both agent addons; no tunnel without FRP.
setup
M="$HOME/.bakers/machine.config.js"
WORKSPACE_NAME=box-1 node "$SCRIPTS/machine-config.mjs" >"$ROOT/out"
check "created" test -f "$M"
check "machine_id is a UUID" bash -c "[[ \$(node -e 'console.log(JSON.parse(process.argv[1]).machine_id)' '$(load "$M")') =~ ^[0-9a-f-]{36}$ ]]"
check "label is the workspace name" test "$(q .label)" = box-1
check "claude and codex addons" test "$(q .addons.join\(\",\"\))" = "@bakers-build/addon-claude,@bakers-build/addon-codex"
check "no tunnel without FRP" test "$(q .tunnel)" = undefined
check "file is private" test "$(mode "$M")" = "-rw-------"

# FRP on: the ports entry with the frpc admin credentials, and tunnel on.
frpc_json
WORKSPACE_NAME=box-1 node "$SCRIPTS/machine-config.mjs" --frp frps.preview.example >"$ROOT/out"
check "tunnel on" test "$(q .tunnel)" = true
check "ports entry uses frp" test "$(q '.addons[2].with.transport.use')" = "@bakers-build/addon-ports-frp"
check "ports entry zone" test "$(q '.addons[2].with.transport.with.zone')" = frps.preview.example
check "ports entry admin password from frpc.json" test "$(q '.addons[2].with.transport.with.adminPassword')" = pw-local
check "ports entry client config path" test "$(q '.addons[2].with.transport.with.clientConfigPath')" = "$HOME/.config/frp/frpc.json"
check "three addons" test "$(q .addons.length)" = 3

# Idempotent, and keeps machine_id and foreign entries.
id=$(q .machine_id)
before=$(cat "$M")
WORKSPACE_NAME=box-1 node "$SCRIPTS/machine-config.mjs" --frp frps.preview.example >"$ROOT/out"
check "second run changes nothing" test "$(cat "$M")" = "$before"
node -e 'const fs=require("fs");const p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace("export default {\n","export default {\n  agents: { default_agent: \"opus\" },\n"))' "$M"
WORKSPACE_NAME=box-1 node "$SCRIPTS/machine-config.mjs" >"$ROOT/out"
check "FRP off again: tunnel gone" test "$(q .tunnel)" = undefined
check "FRP off again: ports entry gone" test "$(q .addons.length)" = 2
check "machine_id kept" test "$(q .machine_id)" = "$id"
check "foreign entry kept" test "$(q .agents.default_agent)" = opus

# A hand-written addons line that already enables claude: not added twice.
setup
M="$HOME/.bakers/machine.config.js"
mkdir -p "$HOME/.bakers"
cat >"$M" <<'EOF'
// @bakers-schema-version 1
export default {
  schema_version: 1,
  machine_id: '0b6f3c1e-9a2d-4e57-8c41-2f7d9e5a1b30',
  label: 'mine',
  addons: [
    '@bakers-build/addon-claude',
  ],
};
EOF
WORKSPACE_NAME=box-1 node "$SCRIPTS/machine-config.mjs" >"$ROOT/out"
check "own label kept" test "$(q .label)" = mine
check "claude once, codex added" test "$(q .addons.join\(\",\"\))" = "@bakers-build/addon-codex,@bakers-build/addon-claude"

# A file that does not load is left alone and the run exits 0.
setup
M="$HOME/.bakers/machine.config.js"
mkdir -p "$HOME/.bakers"
echo 'export default {' >"$M"
WORKSPACE_NAME=box-1 node "$SCRIPTS/machine-config.mjs" >"$ROOT/out"
check "broken file: exit 0" test $? -eq 0
check "broken file: unchanged" test "$(cat "$M")" = 'export default {'
check "broken file: logged" has "$ROOT/out" "machine-config:"

finish
