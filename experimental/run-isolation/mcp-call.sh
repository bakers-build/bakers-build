#!/bin/sh
# THROWAWAY: an MCP session over Streamable HTTP with curl: initialize, tools/list, then
# tools/call of the first tool whose name ends in ticket_read.
#   sh mcp-call.sh <url> [token]
url=$1
auth=${2:+Authorization: Bearer $2}
hdrs=$(mktemp)
sid=
call() {
  curl -s -m 15 -X POST "$url" -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' ${auth:+-H "$auth"} \
    ${sid:+-H "Mcp-Session-Id: $sid"} -D "$hdrs" -d "$1" -w ' [http %{http_code}]'
}
out=$(call '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}')
sid=$(grep -i '^mcp-session-id:' "$hdrs" | cut -d' ' -f2 | tr -d '\r')
echo "initialize: $(echo "$out" | grep -o '"serverInfo":{"name":"[^"]*"\|\[http [0-9]*\]' | tr '\n' ' ')${sid:+session yes}"
call '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
out=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
names=$(echo "$out" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
echo "tools/list: $(echo "$out" | grep -o '\[http [0-9]*\]') $(echo $names)"
tool=$(echo "$names" | grep 'ticket_read$' | head -1)
[ -n "$tool" ] || { echo "tools/list raw: $(echo "$out" | head -c 400)"; rm -f "$hdrs"; exit 1; }
out=$(call "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":{}}}")
echo "tools/call $tool: $(echo "$out" | grep -o 'standin-ok\|\[http [0-9]*\]' | tr '\n' ' ')"
echo "$out" | grep -q standin-ok || echo "tools/call raw: $(echo "$out" | head -c 400)"
rm -f "$hdrs"
