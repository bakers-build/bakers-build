#!/usr/bin/env bash
# provision_up('docs-preview'): build docs/ and serve the built site detached, outside the agent
# sandbox, so `ports_up docs` can share it. One preview per worktree: a call replaces it with a new
# build. `stop` (the after_done hook) ends it.
set -euo pipefail

docs="$(cd "$(dirname "$0")/../docs" && pwd -P)"
log="$docs/.vitepress/cache/preview.log"

# This worktree's preview: a `vitepress … preview` process whose cwd is docs/, the identity the
# ports addon's `docs` service matches. No pid file to go stale.
previews() {
  local p cmd
  for p in /proc/[0-9]*; do
    [ "$(readlink "$p/cwd" 2>/dev/null)" = "$docs" ] || continue
    cmd="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)" || continue
    [[ "$cmd" == *vitepress*' preview '* ]] && echo "${p#/proc/}"
  done
  return 0
}

stop() {
  local pids
  pids="$(previews)"
  [ -n "$pids" ] || return 0
  kill $pids 2>/dev/null || true
  for _ in $(seq 50); do
    [ -n "$(previews)" ] || return 0
    sleep 0.1
  done
  pids="$(previews)"
  [ -z "$pids" ] || kill -9 $pids 2>/dev/null || true
}

if [ "${1:-}" = stop ]; then
  stop
  exit 0
fi

# Stop first: the build empties dist/, which a running preview serves.
stop
cd "$docs"
pnpm build
port="$(node -e 'const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });')"
mkdir -p "${log%/*}"
# Detached and holding none of the caller's pipes, so the provision_up call returns and the
# preview outlives it.
setsid node node_modules/vitepress/bin/vitepress.js preview --host 127.0.0.1 --port "$port" </dev/null >"$log" 2>&1 &

url="http://127.0.0.1:$port/"
for _ in $(seq 300); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)" = 200 ]; then
    echo "Docs preview: $url"
    echo 'Share it with ports_up docs.'
    exit 0
  fi
  sleep 0.1
done
echo "Docs preview did not answer on $url within 30 s:" >&2
tail -n 20 "$log" >&2
stop
exit 1
