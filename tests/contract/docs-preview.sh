#!/usr/bin/env bash
set -euo pipefail
# Run inside an agent run, the conductor's own variables must not steer the scripts under test.
unset BAKERS_WORKTREE_PATH BAKERS_RUNTIME_ISOLATES BAKERS_BRANCH_NAME WORKSPACE_ROOT

# `.bakers/scripts/docs-preview.sh` (the `provision_up('docs-preview')` profile) builds docs/ and serves the
# built site detached, one preview per worktree, on 127.0.0.1 only. A fake `pnpm` on PATH writes a
# numbered build; a fake `vitepress.js` serves it with `node:http` and, like vitepress 1.6 `preview`,
# ignores `--host` (`listen(port, cb)`), then records the address Node bound.

root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
cleanup() {
  for wt in "$work"/wt*; do [ -d "$wt" ] && bash "$wt/.bakers/scripts/docs-preview.sh" stop >/dev/null 2>&1 || true; done
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
  mkdir -p "$wt/.bakers/scripts" "$wt/docs/node_modules/vitepress/bin"
  cp "$root/.bakers/scripts/docs-preview.sh" "$root/.bakers/scripts/docs-preview-loopback.mjs" "$wt/.bakers/scripts/"
  cat > "$wt/docs/node_modules/vitepress/bin/vitepress.js" <<'EOF'
const fs = require('node:fs');
const args = process.argv.slice(2);
const server = require('node:http').createServer((_, res) => {
  res.end(fs.readFileSync('.vitepress/dist/index.html'));
});
server.listen(Number(args[args.indexOf('--port') + 1]), () => {
  fs.writeFileSync('.vitepress/dist/bound', server.address().address);
});
EOF
}

failures=0
fail() { echo "FAIL $case: $*"; failures=$((failures + 1)); }
# run <worktree> [stop]; sets $out, $rc and $url.
run() {
  rc=0
  out="$(cd "$work/$1" && PATH="$work/bin:$PATH" bash .bakers/scripts/docs-preview.sh ${2:-} 2>&1)" || rc=$?
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
bound="$(cat "$work/wt1/docs/.vitepress/dist/bound" 2>/dev/null || true)"
[ "$bound" = 127.0.0.1 ] || fail "listens on '$bound', not 127.0.0.1 only"
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

case=stop; run wt1 stop
[ "$rc" = 0 ] || fail "wt1 exit $rc: $out"
run wt2 stop
[ "$rc" = 0 ] || fail "wt2 exit $rc: $out"
[ "$(previews wt1)$(previews wt2)" = 00 ] || fail "previews left: wt1 $(previews wt1), wt2 $(previews wt2)"
run wt1 stop
[ "$rc" = 0 ] || fail "stop with none running: exit $rc: $out"

case=build-fails; run wt1; touch "$work/wt1/build-fails"; run wt1
[ "$rc" != 0 ] || fail "exit 0: $out"
grep -qF 'build broke' <<<"$out" || fail "no build output: $out"
[ "$(previews wt1)" = 0 ] || fail "$(previews wt1) previews after a failed build"

# Under an isolating runtime the build runs in the web container (a fake `ddev` runs it here) and
# the host serves only the built files, on 127.0.0.1, never following a link out of them.
cat > "$work/bin/ddev" <<'EOF'
#!/bin/bash
echo "$*" >> "$DDEV_CALLS"
case "$1" in
  describe) printf '{"raw":{"approot":"%s"}}\n' "$BAKERS_WORKTREE_PATH" ;;
  # exec --raw --dir /var/www/html/<dir> -- <argv>: the container's project root is the worktree.
  exec) cd "$BAKERS_WORKTREE_PATH${4#/var/www/html}" && shift 5 && exec "$@" ;;
esac
EOF
chmod +x "$work/bin/ddev"
export DDEV_CALLS="$work/ddev-calls"
isolated() {
  rc=0
  out="$(cd "$work/$1" && BAKERS_RUNTIME_ISOLATES=1 BAKERS_WORKTREE_PATH="$work/$1" PATH="$work/bin:$PATH" bash .bakers/scripts/docs-preview.sh ${2:-} 2>&1)" || rc=$?
  url="$(grep -oE 'http://127\.0\.0\.1:[0-9]+/' <<<"$out" | head -1 || true)"
}
served() {
  local docs p n=0
  docs="$(cd "$work/$1/docs" && pwd -P)"
  for p in $(pgrep -f 'docs-preview-serve.mjs' || true); do
    [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$docs" ] && n=$((n + 1))
  done
  echo "$n"
}
case=isolated; worktree wt3
cp "$root/.bakers/scripts/docs-preview-serve.mjs" "$root/.bakers/scripts/ddev-own-project.sh" "$work/wt3/.bakers/scripts/"
: > "$DDEV_CALLS"; isolated wt3
[ "$rc" = 0 ] || fail "exit $rc: $out; calls: $(cat "$DDEV_CALLS")"
grep -qF "exec --raw --dir /var/www/html/docs -- bash -c pnpm install" "$DDEV_CALLS" || fail "build did not run through ddev exec: $(cat "$DDEV_CALLS")"
[ "$(body "$url")" = 'wt3 build 1' ] || fail "serves '$(body "$url")'"
[ "$(served wt3)" = 1 ] && [ "$(previews wt3)" = 0 ] || fail "host runs $(previews wt3) vitepress and $(served wt3) static servers"
echo 'host secret' > "$work/secret"; ln -s "$work/secret" "$work/wt3/docs/.vitepress/dist/leak.txt"
[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "${url}leak.txt")" = 404 ] || fail 'followed a link out of the built site'
[ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' --path-as-is "${url}../../../secret")" = 404 ] || fail 'served a path above the built site'
isolated wt3
[ "$(body "$url")" = 'wt3 build 2' ] && [ "$(served wt3)" = 1 ] || fail "rebuild serves '$(body "$url")' from $(served wt3) servers"
isolated wt3 stop
[ "$rc" = 0 ] && [ "$(served wt3)" = 0 ] || fail "stop left $(served wt3) servers: $out"

[ "$failures" = 0 ] || exit 1
echo 'docs-preview: all cases pass'
