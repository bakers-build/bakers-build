#!/bin/bash
# BB-658 Task 3 — run the loopback-only dropsh MCP process and its local
# nginx proxy as two processes in one container (no s6/supervisord in this
# repo's other images, so plain shell + wait, same spirit as the `cron`
# service's `while true` loop in docker-compose.yml).
#
# bash, not POSIX sh (BB-658 review follow-up): `wait -n` below is a
# bashism `/bin/sh` (dash in this base image) rejects outright, which made
# the container exit immediately on every start.
#
# If either process dies the container exits non-zero, so Docker/Komodo
# restarts the whole thing rather than limping along with half a service.
set -eu

/opt/dropsh/bin/dropsh --config ./dropsh.config.js mcp serve --http 8787 &
MCP_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

term() {
  kill -TERM "$MCP_PID" "$NGINX_PID" 2>/dev/null || true
}
trap term TERM INT

set +e
wait -n "$MCP_PID" "$NGINX_PID"
STATUS=$?
set -e

term
wait "$MCP_PID" "$NGINX_PID" 2>/dev/null || true
exit "$STATUS"
