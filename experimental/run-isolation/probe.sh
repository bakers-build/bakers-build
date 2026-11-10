#!/usr/bin/env bash
# THROWAWAY spike probe (docs/decisions/run-isolation.md). Run from the worktree root, outside any
# agent sandbox:  bash experimental/run-isolation/probe.sh
# Read-only on the host except: builds the image, writes ~/.cache/bakers-isolation/probe/ and, with
# sbx installed, creates and removes a sandbox bb-probe. `--sbx-only` skips the Docker part.
set -uo pipefail
root="$(git rev-parse --show-toplevel)"
here="$root/experimental/run-isolation"
img=bakers-run-isolation:spike

# A stand-in for the conductor tool server: an MCP server on the host's 127.0.0.1 that wants a
# bearer token, built on the same SDK and transport.
port=$(( 20000 + RANDOM % 10000 ))
token="probe-$RANDOM$RANDOM"
node "$here/mcp-standin.mjs" "$port" "$token" >/dev/null 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null' EXIT
sleep 2

# What the run reports from inside; the same for both backends. The token comes from the run's env,
# as the claude addon's --mcp-config references ${BB_CONDUCTOR_TOKEN}.
inside="echo \"user: \$(id -u) home: \$HOME\"
echo -n 'git status: '; git status --short --branch | head -1
for p in ~/.ssh ~/.bakers /home/*/.ssh /root/.ssh; do [ -e \"\$p\" ] && echo \"VISIBLE \$p\" || echo \"absent \$p\"; done
test -S /var/run/docker.sock && echo 'docker socket: VISIBLE' || echo 'docker socket: absent'
for h in 127.0.0.1 host.docker.internal; do
  echo \"conductor MCP via \$h:\"; sh '$here/mcp-call.sh' \"http://\$h:$port/\" \"\$BB_CONDUCTOR_TOKEN\"
done
echo -n 'git push --dry-run: '; git push --dry-run origin HEAD >/dev/null 2>&1 && echo 'SUCCEEDED' || echo 'failed'
command -v claude >/dev/null && echo \"claude: \$(claude --version)\" || echo 'claude: missing'"

if [ "${1:-}" != "--sbx-only" ]; then
echo "== docker: image"
docker build -q -t "$img" "$here" || exit 1
echo "== docker: start time"
for t in cold warm; do
  s=$(date +%s%N); docker run --rm "$img" true; echo "$t: $(( ($(date +%s%N) - s) / 1000000 )) ms"
done

echo "== docker: run through the decorator's launch rewrite"
cmd=$(cd "$here" && INSIDE="$inside" WS="$root" node --input-type=module -e "
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { wrapRun } from './isolation-docker.mjs';
const ws = process.env.WS;
const runHome = homedir() + '/.cache/bakers-isolation/probe';
mkdirSync(runHome, { recursive: true });
const gitCommonDir = execSync('git -C ' + JSON.stringify(ws) + ' rev-parse --path-format=absolute --git-common-dir').toString().trim();
const out = wrapRun(
  { workspacePath: ws, run: { id: 'probe', uuid: 'probe' }, command: process.env.INSIDE, env: { BB_CONDUCTOR_TOKEN: '$token' } },
  { image: '$img', mounts: [] },
  { gitCommonDir, runHome, hostHome: homedir() },
);
console.log(out.command);
")
# No TTY under a plain shell: drop -it for the probe only.
BB_CONDUCTOR_TOKEN="$token" sh -c "${cmd/ -it/}"
fi

echo "== sbx"
command -v sbx >/dev/null || { echo "sbx missing: skipped"; exit 0; }
sbx version
gitdir="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)"
mcp=bb-probe-mcp
cleanup() {
  sbx rm -f bb-probe >/dev/null 2>&1
  sbx mcp rm -f "$mcp" >/dev/null 2>&1
  sbx secret rm -f "mcp:$mcp:token" >/dev/null 2>&1
  kill $srv 2>/dev/null
}
trap cleanup EXIT
cleanup; node "$here/mcp-standin.mjs" "$port" "$token" >/dev/null 2>&1 & srv=$!; sleep 2
# Route 1: the sbx MCP gateway. The token stays in the host secret store, never in the sandbox.
# The secret first: `mcp add` probes the endpoint, and a 401 reads to it as "needs OAuth".
echo -n "$token" | sbx secret set -f "mcp:$mcp:token" \
  && sbx mcp add "$mcp" --url "http://127.0.0.1:$port/" --skip-ssrf-check --skip-auth \
       --header 'Authorization: Bearer ${token}' \
  && sbx mcp inspect "$mcp" || { echo "sbx mcp add failed"; exit 1; }
# The claude agent kit, so sbx's agent integration writes the gateway into the agent's config.
sbx create --no-input --no-progress --name bb-probe --static-mcp "$mcp" -e BB_CONDUCTOR_TOKEN="$token" \
  claude "$root" "$gitdir" || { echo "sbx create failed"; exit 1; }
echo "-- route 2: direct to the host, token in the run env"
sbx exec -w "$root" bb-probe sh -c "$inside"
echo "-- route 1: where the gateway shows up inside"
sbx exec bb-probe sh -c 'env | grep -iE "mcp|gateway" | sed "s/=.*token.*/=<redacted>/I"; for f in ~/.claude.json ~/.claude/settings.json ~/.mcp.json /etc/claude-code/*.json; do [ -f "$f" ] && { echo "$f:"; grep -o "\"mcpServers\".\{0,400\}" "$f"; }; done'
echo "-- route 1: call every MCP URL found in the agent config, without a token"
for u in $(sbx exec bb-probe sh -c 'cat ~/.claude.json ~/.claude/settings.json ~/.mcp.json 2>/dev/null' | grep -o 'https\?://[^"]*' | sort -u); do
  echo "gateway $u:"; sbx exec bb-probe sh "$here/mcp-call.sh" "$u"
done
