#!/usr/bin/env bash
# THROWAWAY spike probe (docs/decisions/run-isolation.md). Run from the worktree root, outside any
# agent sandbox:  bash experimental/run-isolation/probe.sh
# Read-only on the host except: builds the image and writes ~/.cache/bakers-isolation/probe/.
set -uo pipefail
root="$(git rev-parse --show-toplevel)"
here="$root/experimental/run-isolation"
img=bakers-run-isolation:spike

# A stand-in for the conductor tool server: something listening on the host's 127.0.0.1.
port=$(( 20000 + RANDOM % 10000 ))
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$(mktemp -d)" >/dev/null 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null' EXIT
sleep 1

# What the run reports from inside; the same for both backends.
inside="echo \"user: \$(id -u) home: \$HOME\"
echo -n 'git status: '; git status --short --branch | head -1
for p in ~/.ssh ~/.bakers /home/*/.ssh /root/.ssh; do [ -e \"\$p\" ] && echo \"VISIBLE \$p\" || echo \"absent \$p\"; done
test -S /var/run/docker.sock && echo 'docker socket: VISIBLE' || echo 'docker socket: absent'
for h in 127.0.0.1 host.docker.internal; do
  node -e \"fetch('http://'+process.argv[1]+':$port/').then(r=>console.log('host service via',process.argv[1],r.status)).catch(e=>console.log('host service via',process.argv[1],'FAILED',e.cause?.code||e.message))\" \"\$h\" 2>/dev/null || echo \"host service via \$h: no node\"
done
echo -n 'git push --dry-run: '; git push --dry-run origin HEAD >/dev/null 2>&1 && echo 'SUCCEEDED' || echo 'failed'
command -v claude >/dev/null && echo \"claude: \$(claude --version)\" || echo 'claude: missing'"

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
  { workspacePath: ws, run: { id: 'probe', uuid: 'probe' }, command: process.env.INSIDE, env: { BB_CONDUCTOR_TOKEN: 'probe-token' } },
  { image: '$img', mounts: [] },
  { gitCommonDir, runHome, hostHome: homedir() },
);
console.log(out.command);
")
# No TTY under a plain shell: drop -it for the probe only.
BB_CONDUCTOR_TOKEN=probe-token sh -c "${cmd/ -it/}"

echo "== sbx"
# shortcut: sbx is only detected; its probe needs an interactive session and follows once it is installed.
command -v sbx >/dev/null && sbx version || echo "sbx missing: skipped"
