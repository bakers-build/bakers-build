#!/usr/bin/env bash
# In-image smoke test (README › Build): every tool answers with its pinned version, glab can serve
# git credentials, and Playwright launches Chromium headless from the image without a download.
#   docker run --rm <image> /usr/local/share/bakers-ddev/smoke.sh
set -uo pipefail
status=0
expect() { # expect NAME PATTERN COMMAND...
  local name=$1 pattern=$2 out
  shift 2
  if out=$("$@" 2>&1) && grep -qE -- "$pattern" <<<"$out"; then
    echo "ok   $name: $(head -n 1 <<<"$out")"
  else
    echo "FAIL $name: $(head -n 3 <<<"$out")"
    status=1
  fi
}

expect bakers '0\.7\.0' bakers --version
expect herdr '0\.9\.5' herdr --version
expect claude '2\.1\.306' claude --version
expect codex '0\.163\.0' codex --version
expect cursor-agent '2026\.10\.19' cursor-agent --version
expect gh '2\.102\.1' gh --version
expect glab '1\.124\.0' glab --version
expect "glab git-credential" 'git-credential|credential' glab auth git-credential --help
expect cloudflared '2026\.10\.2' cloudflared --version
expect frpc '0\.68\.0' frpc --version
expect ss 'ss utility' ss -V
expect playwright '1\.65\.0' playwright --version
expect "tools from /usr/local" '^/usr/local/bin/claude$' command -v claude
expect "managed settings" 'laws-of-robotics' cat /etc/claude-code/managed-settings.json
expect "Chromium headless, no download" '^launched' env NODE_PATH=/usr/local/lib/node_modules node -e "
  const { chromium } = require('playwright');
  chromium.launch({ headless: true }).then(async (b) => { const p = await b.newPage(); await p.setContent('<p>ok</p>');
    console.log('launched', await p.textContent('p')); await b.close(); }).catch((e) => { console.error(e.message); process.exit(1); });"

[ "$status" -eq 0 ] && echo "smoke: all passed" || echo "smoke: failed"
exit "$status"
