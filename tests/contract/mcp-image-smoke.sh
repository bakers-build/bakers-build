#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Container smoke test for the BB-658 MCP image (docker/mcp/**).
#
#   bash tests/contract/mcp-image-smoke.sh
#
# Builds the real image (git-clones the pinned dropsh commit, builds it) and
# starts it, then confirms the in-container nginx proxy actually answers an
# MCP `initialize` request — the one thing config-rendering alone (see
# mcp-compose.sh) cannot prove: that `@dropsh/plugin-mcp` and its sibling
# plugins actually resolve and the process starts (BB-658 review F3).
#
# Slow (clones + builds a Node image) and needs network + Docker; run it when
# docker/mcp/** changes, not on every revision.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

IMAGE=bakers-mcp-smoke:local
CONTAINER=bakers-mcp-smoke

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build -f docker/mcp/Dockerfile -t "$IMAGE" .

docker run -d --rm --name "$CONTAINER" \
  -p 18080:8080 \
  -e MCP_BASE_URL=https://example.test \
  "$IMAGE"

ok=0
for _ in $(seq 1 20); do
  sleep 0.5
  status="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:18080/mcp || true)"
  if [ "$status" = "401" ]; then
    ok=1
    break
  fi
done

docker logs "$CONTAINER" || true

if [ "$ok" != "1" ]; then
  echo "FAIL: /mcp never answered 401 (missing bearer) — the process likely failed to start" >&2
  exit 1
fi

# The 401 above is nginx's own check (BB-658 review N1): it fires even if
# dropsh crashed right after nginx started, which is exactly the F3 failure
# class this script exists to catch. Only a real `initialize` call proves the
# dropsh-mcp process itself is alive and its plugins resolved.
init_body="$(curl -s -X POST http://127.0.0.1:18080/mcp \
  -H 'Authorization: Bearer x' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}')"

if ! grep -q 'dropsh-mcp' <<<"$init_body"; then
  echo "FAIL: /mcp initialize did not answer with dropsh-mcp — process likely crashed after nginx started" >&2
  echo "$init_body" >&2
  exit 1
fi

echo "ok: mcp image starts, /mcp answers 401 without a bearer, and initialize answers as dropsh-mcp"
