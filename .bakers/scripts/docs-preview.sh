#!/usr/bin/env bash
# provision_up('docs-preview'): build docs/ and serve the built site detached, outside the agent
# sandbox, so `ports_up docs` can share it. One preview per worktree: a call replaces it with a new
# build. `stop` (the after_done hook) ends it.
# Under an isolating runtime (BAKERS_RUNTIME_ISOLATES=1) the run can write docs/, so its build runs
# in the DDEV web container and the host serves only the built files.
set -euo pipefail

scripts="$(cd "$(dirname "$0")" && pwd -P)"
docs="$(cd "$scripts/../../docs" && pwd -P)"
log="$docs/.vitepress/cache/preview.log"
if [ "${BAKERS_RUNTIME_ISOLATES:-0}" = 1 ]; then
  # The run can plant links in docs/: the host follows none, and logs outside the workspace.
  [ "$docs" = "$(cd "$scripts/../.." && pwd -P)/docs" ] || { echo 'docs/ is a link' >&2; exit 1; }
  log="${XDG_CACHE_HOME:-$HOME/.cache}/bakers/docs-preview/$(printf %s "$docs" | sha256sum | cut -c1-16).log"
fi

# This worktree's preview: a process whose cwd is docs/ and whose command names vitepress, the
# identity the ports addon's `docs` service matches: `vitepress … preview`, or the static server
# on `.vitepress/dist`. No pid file to go stale.
previews() {
  local p cmd
  for p in /proc/[0-9]*; do
    [ "$(readlink "$p/cwd" 2>/dev/null)" = "$docs" ] || continue
    cmd="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)" || continue
    [[ "$cmd" == *vitepress*' preview '* || "$cmd" == *docs-preview-serve.mjs' .vitepress/dist '* ]] && echo "${p#/proc/}"
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
if [ "${BAKERS_RUNTIME_ISOLATES:-0}" = 1 ]; then
  (cd "$scripts/../.." && bash .bakers/scripts/ddev-own-project.sh)
  ddev exec --raw --dir /var/www/html/docs -- bash -c 'pnpm install --config.minimumReleaseAge=0 && pnpm build'
  serve=(node "$scripts/docs-preview-serve.mjs" .vitepress/dist)
else
  pnpm build
  # The loopback preload binds it to 127.0.0.1, which vitepress' --host does not.
  serve=(node --import "$scripts/docs-preview-loopback.mjs" node_modules/vitepress/bin/vitepress.js preview)
fi
port="$(node -e 'const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });')"
mkdir -p "${log%/*}"
# Detached and holding none of the caller's pipes, so the provision_up call returns and the
# preview outlives it.
setsid "${serve[@]}" --port "$port" </dev/null >"$log" 2>&1 &
pid=$!

url="http://127.0.0.1:$port/"
for _ in $(seq 300); do
  kill -0 "$pid" 2>/dev/null || break
  if [ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "$url" || true)" = 200 ]; then
    echo "Docs preview: $url"
    echo 'Share it with ports_up docs.'
    exit 0
  fi
  sleep 0.1
done
echo "Docs preview did not answer on $url:" >&2
tail -n 20 "$log" >&2
stop
exit 1
