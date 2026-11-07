#!/usr/bin/env bash
set -euo pipefail

# `.ddev/commands/host/provision` reuses a ready site, starts a stopped one and installs a missing
# or different one. A fake `ddev` on PATH logs its calls; a local HTTP server stands in for the site.

root="$(git rev-parse --show-toplevel)"
script="$root/.ddev/commands/host/provision"
work="$(mktemp -d)"
server_pid=
cleanup() { [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

mkdir -p "$work/bin"
cat > "$work/bin/ddev" <<'EOF'
#!/bin/bash
echo "$*" >> "$STATE/calls"
case "$1" in
  describe)
    [ -f "$STATE/status" ] || { echo 'no project' >&2; exit 1; }
    printf '{"raw":{"status":"%s","primary_url":"%s"}}\n' "$(cat "$STATE/status")" "$URL" ;;
  start) echo running > "$STATE/status" ;;
  init)
    if [ -f "$STATE/init-fails" ]; then echo 'init broke'; exit 2; fi
    echo running > "$STATE/status" ;;
esac
EOF
chmod +x "$work/bin/ddev"

echo 200 > "$work/http-code"
CODE_FILE="$work/http-code" node -e '
const fs = require("node:fs");
const server = require("node:http").createServer((_, res) => {
  res.statusCode = Number(fs.readFileSync(process.env.CODE_FILE, "utf8")); res.end();
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
' > "$work/port" &
server_pid=$!
for _ in $(seq 50); do [ -s "$work/port" ] && break; sleep 0.1; done
export URL="http://127.0.0.1:$(cat "$work/port")"

failures=0
fail() { echo "FAIL $case: $*"; failures=$((failures + 1)); }

# arrange <status|-> <marker|-> <http code>; then run <provider>; sets $out and $rc.
arrange() {
  export STATE="$work/state"
  rm -rf "$STATE" "$work/app"; mkdir -p "$STATE" "$work/app/.ddev/.bakers-test"; : > "$STATE/calls"
  [ "$1" = - ] || echo "$1" > "$STATE/status"
  [ "$2" = - ] || echo "$2" > "$work/app/.ddev/.bakers-test/profile"
  echo "$3" > "$work/http-code"
}
run() {
  rc=0
  out="$(cd "$work/app" && DDEV_APPROOT="$work/app" PATH="$work/bin:$PATH" bash "$script" --provider "$1" 2>&1)" || rc=$?
}
calls() { grep -cE "^$1" "$STATE/calls" || true; }
marker() { cat "$work/app/.ddev/.bakers-test/profile" 2>/dev/null || true; }

case=ready; arrange running recipe-test 200; run recipe-test
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ "$(calls 'start|init')" = 0 ] || fail "ran setup: $(cat "$STATE/calls")"
grep -qF "ready $URL" <<<"$out" || fail "no ready URL: $out"

case=stopped; arrange stopped recipe-test 200; run recipe-test
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ "$(calls start)" = 1 ] && [ "$(calls init)" = 0 ] || fail "calls: $(cat "$STATE/calls")"
grep -qF "started $URL" <<<"$out" || fail "no started URL: $out"

case=missing; arrange - - 200; run recipe-test
[ "$rc" = 0 ] || fail "exit $rc: $out"
grep -qx 'init --provider recipe-test' "$STATE/calls" || fail "no init: $(cat "$STATE/calls")"
[ "$(marker)" = recipe-test ] || fail "marker: $(marker)"
grep -qF "installed $URL" <<<"$out" || fail "no installed URL: $out"

case=other-profile; arrange running existing-config 200; run recipe-test
[ "$rc" = 0 ] || fail "exit $rc: $out"
grep -qx 'init --provider recipe-test' "$STATE/calls" || fail "no init: $(cat "$STATE/calls")"
[ "$(marker)" = recipe-test ] || fail "marker: $(marker)"

case=init-fails; arrange running existing-config 200; touch "$STATE/init-fails"; run recipe-test
[ "$rc" != 0 ] || fail 'exit 0'
grep -q 'init broke' <<<"$out" || fail "output lost: $out"
[ -z "$(marker)" ] || fail "marker left: $(marker)"

case=url-500; arrange - - 500; run recipe-test
[ "$rc" != 0 ] || fail "exit 0: $out"

case=no-provider; arrange - - 200; rc=0
out="$(cd "$work/app" && PATH="$work/bin:$PATH" bash "$script" 2>&1)" || rc=$?
[ "$rc" != 0 ] || fail 'exit 0'

# Agents run Playwright through ddev_exec, so the web image's browsers must match the suite's lock.
case=playwright-image
locked="$(node -p 'require(process.argv[1]).packages["node_modules/@playwright/test"].version' "$root/tests/playwright/package-lock.json")"
image="$root/.ddev/web-build/Dockerfile.playwright"
grep -qF "playwright@$locked " "$image" 2>/dev/null || fail "$image does not install playwright@$locked"
grep -qE '@playwright/cli@[0-9]+\.[0-9]+\.[0-9]+ ' "$image" 2>/dev/null || fail "$image does not pin @playwright/cli"
grep -qF "cd tests/playwright && npm ci" "$root/.ddev/commands/host/init" || fail 'init does not install the Playwright suite'

# That test code is untrusted: the web container gets no SSH agent and no registry token.
case=container-credentials
config="$root/.ddev/config.yaml"
grep -qE '^omit_containers: \[.*ddev-ssh-agent.*\]' "$config" || fail 'ddev-ssh-agent is not omitted'
for token in KEYTEC_REGISTRY_TOKEN KEYTEC_REGISTRY_WRITE_TOKEN; do
  grep -qE "^  - $token=\$" "$config" || fail "$token is not blanked in web_environment"
done

[ "$failures" = 0 ] || exit 1
echo 'PASS ddev provision: ready, stopped, missing, other profile, init failure, URL 500, no provider, Playwright image, container credentials'
