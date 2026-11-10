#!/bin/sh
# THROWAWAY: what an isolated run reports when an executor starts it. Writes to $OUT, then stays
# alive past herdr's 4 s launch watch, like an agent would.
here=$(dirname "$0")
{
  echo "user: $(id -u) home: $HOME"
  # stdout goes to the report here, so only stdin tells whether the run has a terminal.
  test -t 0 && echo "tty: yes ($(tty))" || echo "tty: NO"
  echo -n 'git status: '; git status --short --branch | head -1
  for p in ~/.ssh ~/.bakers; do [ -e "$p" ] && echo "VISIBLE $p" || echo "absent $p"; done
  url=${MCP_URL:-$MCP_GATEWAY_URL}
  echo "conductor MCP via $url:"; sh "$here/mcp-call.sh" "$url" "$BB_CONDUCTOR_TOKEN"
  command -v claude >/dev/null && echo "claude: $(claude --version)" || echo 'claude: missing'
} > "$OUT.tmp" 2>&1
mv "$OUT.tmp" "$OUT"
sleep 8
