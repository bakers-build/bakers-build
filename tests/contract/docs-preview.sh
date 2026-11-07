#!/usr/bin/env bash
set -euo pipefail

# `scripts/docs-preview.sh` (the `provision_up('docs-preview')` profile) builds docs/ and serves the
# built site detached, one preview per worktree. A fake `pnpm` on PATH writes a numbered build; a
# fake `vitepress.js` serves it with `node:http`.

root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
cleanup() {
  for wt in "$work"/wt*; do [ -d "$wt" ] && bash "$wt/scripts/docs-preview.sh" stop >/dev/null 2>&1 || true; done
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/bin"
cat > "$work/bin/pnpm" <<'EOF'
#!/bin/bash
[ "$1" = build ] || exit 0
if [ -f ../build-fails ]; then echo 'build broke'; exit 2; fi
n=$(( $(cat ../builds 2>/dev/null || echo 0) + 1 )); echo "$n" > ../builds
mkdir -p .vitepress/dist; echo "$(basename "$(dirname "$PWD")") build $n" > .vitepress/dist/index.html
EOF
chmod +x "$work/bin/pnpm"

# worktree <name>: a worktree root holding the real script and a fake vitepress.
worktree() {
  local wt="$work/$1"
  mkdir -p "$wt/scripts" "$wt/docs/node_modules/vitepress/bin"
  cp "$root/scripts/docs-preview.sh" "$wt/scripts/"
  cat > "$wt/docs/node_modules/vitepress/bin/vitepress.js" <<'EOF'
const args = process.argv.slice(2);
const opt = (name) => args[args.indexOf(name) + 1];
require('node:http').createServer((_, res) => {
  res.end(require('node:fs').readFileSync('.vitepress/dist/index.html'));
}).listen(Number(opt('--port')), opt('--host'));
EOF
}

failures=0
fail() { echo "FAIL $case: $*"; failures=$((failures + 1)); }
# run <worktree> [stop]; sets $out, $rc and $url.
run() {
  rc=0
  out="$(cd "$work/$1" && PATH="$work/bin:$PATH" bash scripts/docs-preview.sh ${2:-} 2>&1)" || rc=$?
  url="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/' <<<"$out" | head -1 || true)"
}
body() { curl -s --max-time 2 "$1" || true; }
# previews <worktree>: the number of vitepress preview processes running in its docs/.
previews() {
  local docs p n=0
  docs="$(cd "$work/$1/docs" && pwd -P)"
  for p in $(pgrep -f 'vitepress.js preview' || true); do
    [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$docs" ] && n=$((n + 1))
  done
  echo "$n"
}

case=start; worktree wt1; run wt1
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ -n "$url" ] || fail "no URL: $out"
[ "$(body "$url")" = 'wt1 build 1' ] || fail "serves '$(body "$url")'"
first="$url"

case=rebuild; run wt1
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ "$(body "$url")" = 'wt1 build 2' ] || fail "serves '$(body "$url")'"
[ "$(previews wt1)" = 1 ] || fail "$(previews wt1) previews"
[ "$url" = "$first" ] || [ -z "$(body "$first")" ] || fail "old preview $first still answers"
wt1_url="$url"

case=parallel; worktree wt2; run wt2
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ "$url" != "$wt1_url" ] || fail "same port as wt1: $url"
[ "$(body "$url")" = 'wt2 build 1' ] || fail "serves '$(body "$url")'"
[ "$(body "$wt1_url")" = 'wt1 build 2' ] || fail "wt1 now serves '$(body "$wt1_url")'"
[ "$(previews wt2)" = 1 ] || fail "$(previews wt2) previews in wt2"

case=stop; run wt1 stop; run wt2 stop
[ "$rc" = 0 ] || fail "exit $rc: $out"
[ "$(previews wt1)$(previews wt2)" = 00 ] || fail "previews left: wt1 $(previews wt1), wt2 $(previews wt2)"
run wt1 stop
[ "$rc" = 0 ] || fail "stop with none running: exit $rc: $out"

case=build-fails; run wt1; touch "$work/wt1/build-fails"; run wt1
[ "$rc" != 0 ] || fail "exit 0: $out"
grep -qF 'build broke' <<<"$out" || fail "no build output: $out"
[ "$(previews wt1)" = 0 ] || fail "$(previews wt1) previews after a failed build"

[ "$failures" = 0 ] || exit 1
echo 'docs-preview: all cases pass'
