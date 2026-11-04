#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Smoke test of the PM bot's image (experimental/pm-bot/Dockerfile).
#
#   bash tests/contract/pm-bot-image.sh [IMAGE]
#
# Without IMAGE it builds experimental/pm-bot/ as pm-bot:check first. The data directory
# is a Docker volume seeded as the Coder script leaves it (owned by uid 1000,
# .env mode 600), so the test runs the same against a local daemon and CI's
# Docker-in-Docker. It asserts:
#   - check mode: Hermes is the version the bot is written for, node is
#     present, config.yaml is rendered with no placeholder left but the
#     ${env:BAKERS_API_KEY} Hermes fills, and without the key itself; Hermes
#     connects to bakers.build's /mcp (a stub of it, pm-bot-mcp-stub.mjs, in a
#     container of the same image) with the key as bearer and takes exactly the
#     eight included tools; with a wrong key the check fails; the skill's project
#     reference is rendered
#   - SOUL.md and the project-manager skill in the data directory are the
#     image's (a hand edit to SOUL.md is restored); a learned skill and a
#     session are kept
#   - a missing required key stops the start and is named
#   - run mode, with the capabilities and options of the template's compose
#     file: the poller and exactly one gateway run, as hermes, on the first
#     start and again on a start over the same data directory
# Needs Docker.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

HERMES_VERSION=v0.22.5
# The coder user of the bakers-ddev workspace image.
OWNER=1000
COMPOSE=coder/bakers-ddev/pm-bot.compose.yaml

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  IMAGE=pm-bot:check
  # The skill contexts: this repository's bundle, superpowers v7.0.0 and mattpocock/skills v1.3.2.
  docker build -q -t "$IMAGE" \
    --build-context bundle=.claude/skills/bakers-build \
    --build-context superpowers=https://github.com/obra/superpowers.git#bb92a77741419a4ab5f06e711a283343f1ada0c3 \
    --build-context mattpocock=https://github.com/mattpocock/skills.git#d1478fcb140db0b93c0c8df17bcfd311844749d0 experimental/pm-bot >/dev/null || fail "docker build experimental/pm-bot failed"
fi

volume="pm-bot-check-$$"
name="pm-bot-check-$$"
net="pm-bot-check-$$"
stub="pm-bot-stub-$$"
trap 'docker rm -f "$name" "$stub" >/dev/null 2>&1; docker volume rm -f "$volume" >/dev/null 2>&1; docker network rm "$net" >/dev/null 2>&1' EXIT
docker volume create "$volume" >/dev/null
docker network create "$net" >/dev/null

# bakers.build's /mcp, stubbed: it answers only the fixture's API key.
key="$(sed -n 's/^BAKERS_API_KEY=//p' experimental/pm-bot/test/fixture.env)"
[ -n "$key" ] || fail "experimental/pm-bot/test/fixture.env has no BAKERS_API_KEY"
docker run -d --name "$stub" --network "$net" -e STUB_KEY="$key" --entrypoint node "$IMAGE" \
  --input-type=module -e "$(cat tests/contract/pm-bot-mcp-stub.mjs)" >/dev/null || fail "the /mcp stub does not start"
BAKERS_URL="http://$stub:8080"

# In the data volume, as root of a throwaway container.
in_data() { docker run --rm -i -v "$volume:/d" --entrypoint sh "$IMAGE" -c "$1"; }

# What the Coder script and a running bot leave behind, and what must survive the next start.
# The env file points at the stub, as the Coder script writes it for a real site.
sed "s|^BAKERS_URL=.*|BAKERS_URL=$BAKERS_URL|" experimental/pm-bot/test/fixture.env | in_data "umask 077; cat >/d/.env; mkdir -p /d/skills/learned /d/sessions
  echo kept >/d/skills/learned/SKILL.md; echo kept >/d/sessions/one.json; echo 'hand edit' >/d/SOUL.md
  chown -R $OWNER:$OWNER /d"

# The compose file's hardening, as docker run options.
caps=(--cap-drop ALL)
while read -r cap; do caps+=(--cap-add "$cap"); done < <(sed -n 's/^ *- \([A-Z_]*\) *# cap$/\1/p' "$COMPOSE")
[ ${#caps[@]} -gt 2 ] || fail "no capability list in $COMPOSE"
start() {
  docker run --env-file experimental/pm-bot/test/fixture.env -e BAKERS_URL="$BAKERS_URL" --network "$net" -e HERMES_UID=$OWNER -e HERMES_GID=$OWNER \
    -v "$volume:/opt/data" "${caps[@]}" --security-opt no-new-privileges:true "$@"
}

out="$(start --rm "$IMAGE" check 2>&1)" || { echo "$out" >&2; fail "check mode failed"; }
grep -q "Hermes Agent $HERMES_VERSION " <<<"$out" || { echo "$out" >&2; fail "Hermes is not $HERMES_VERSION"; }
pass "Hermes $HERMES_VERSION"
grep -qE '^node v[0-9]+\.' <<<"$out" || { echo "$out" >&2; fail "node is missing"; }
pass "node present"

config="$(in_data 'cat /d/config.yaml')" || fail "config.yaml was not rendered"
! grep -v -F '${env:BAKERS_API_KEY}' <<<"$config" | grep -n '\${' || fail "config.yaml keeps a placeholder"
grep -q 'Bearer ${env:BAKERS_API_KEY}' <<<"$config" || fail "config.yaml does not leave the API key to Hermes"
! grep -qF "$key" <<<"$config" || fail "config.yaml holds the API key"
grep -q 'C0000000001,C0000000002' <<<"$config" || fail "config.yaml lacks the allowed channels"
grep -qF "url: $BAKERS_URL/mcp" <<<"$config" || fail "config.yaml does not reach bakers.build's /mcp"
pass "config.yaml rendered, no placeholder left but the key Hermes fills, no key in it"

grep -q 'Connected' <<<"$out" || { echo "$out" >&2; fail "Hermes does not connect to /mcp with the API key"; }
grep -qx 'bakers tools: tool_api__bakers_comment_publish,tool_api__bakers_ticket_classify,tool_api__bakers_ticket_create,tool_api__bakers_ticket_read,tool_api__bakers_ticket_search,tool_api__bakers_ticket_transition,tool_api__bakers_ticket_update,tool_api__bakers_user_read' <<<"$out" \
  || { echo "$out" >&2; fail "Hermes does not register exactly the eight included tools of the nine offered"; }
pass "Hermes connects to /mcp with the API key as bearer and takes exactly the eight tools"

in_data "sed -i 's/^BAKERS_API_KEY=.*/BAKERS_API_KEY=wrong-key/' /d/.env"
out="$(start --rm -e BAKERS_API_KEY=wrong-key "$IMAGE" check 2>&1)" && { echo "$out" >&2; fail "check passed with a wrong API key"; }
grep -qE 'Connection failed.*(401|[Uu]nauthori)' <<<"$out" || { echo "$out" >&2; fail "a wrong API key does not fail on authentication"; }
in_data "sed -i 's/^BAKERS_API_KEY=.*/BAKERS_API_KEY=$key/' /d/.env"
pass "a wrong API key fails the check"

ref=/d/skills/project-manager/references
in_data "[ ! -e $ref/project.template.md ] && grep -qF $BAKERS_URL $ref/project.md" \
  || fail "the skill's project reference was not rendered"
in_data 'cat /d/skills/project-manager/SKILL.md' | cmp -s - experimental/pm-bot/skills/project-manager/SKILL.md \
  || fail "the project-manager skill is not the image's"
in_data 'cat /d/SOUL.md' | cmp -s - experimental/pm-bot/SOUL.md || fail "SOUL.md is not the image's (hand edit kept?)"
pass "SOUL.md and the project-manager skill are the image's"

[ "$(in_data 'cat /d/skills/learned/SKILL.md /d/sessions/one.json')" = "kept
kept" ] || fail "a learned skill or a session was lost"
pass "learned skills and sessions kept"

out="$(start --rm -e PM_BOT_PROJECT= -e SLACK_ADMIN_USERS= "$IMAGE" check 2>&1)" && fail "check passed without PM_BOT_PROJECT"
grep -q 'missing: SLACK_ADMIN_USERS PM_BOT_PROJECT' <<<"$out" || { echo "$out" >&2; fail "the missing keys are not named"; }
pass "a missing key stops the start and is named"

# Starts the bot in a new container on the data volume, as a workspace start does, and
# checks that the poller and exactly one gateway run in it, as hermes.
run_bot() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  start -d --name "$name" "$IMAGE" >/dev/null || fail "the image does not start ($1)"
  procs=""
  for _ in $(seq 1 30); do
    sleep 2
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || break
    procs="$(docker exec "$name" ps -eo user=,args= 2>/dev/null)" || continue
    grep -q 'poller.mjs' <<<"$procs" && grep -qE 'gateway run$' <<<"$procs" && break
  done
  grep -qE '^hermes .*node /opt/pm-bot/poller/poller.mjs' <<<"$procs" \
    || { docker logs "$name" 2>&1 | tail -30 >&2; fail "the poller does not run as hermes ($1)"; }
  grep -qE '^hermes .*gateway run$' <<<"$procs" || { docker logs "$name" 2>&1 | tail -30 >&2; fail "the gateway does not run as hermes ($1)"; }
  sleep 10
  procs="$(docker exec "$name" ps -eo user=,args=)"
  grep -qE '^hermes .*node /opt/pm-bot/poller/poller.mjs' <<<"$procs" \
    || { docker logs "$name" 2>&1 | tail -30 >&2; fail "the poller stopped ($1)"; }
  # Hermes' own supervised gateway runs as python -c with sys.argv[0]='hermes', the entrypoint's
  # as hermes_cli.main ... gateway run; together they must be one.
  gateways="$(grep -cE "hermes_cli.main.*gateway|sys.argv\[0\]='hermes'" <<<"$procs" || true)"
  [ "$gateways" = 1 ] || { echo "$procs" >&2; fail "$gateways gateways run, not one ($1)"; }
  [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || fail "the container stopped ($1)"
  pass "one container runs the poller and exactly one gateway, as hermes ($1)"
}
run_bot "first start"
# A workspace stop kills the container without a clean exit, so the gateway's state file
# still says "running", the state a gateway connected to Slack writes. The test's gateway never
# reaches Slack, so the state is set to that after the kill. The next start must still run the
# gateway beside the poller, not hand it to Hermes' own supervisor and lose the poller.
docker kill -s KILL "$name" >/dev/null
in_data 'test -f /d/gateway_state.json && sed -i -E "s/\"gateway_state\": *\"[a-z_]+\"/\"gateway_state\": \"running\"/" /d/gateway_state.json && grep -q "\"gateway_state\": \"running\"" /d/gateway_state.json' \
  || fail "the killed gateway left no state file to restart from"
run_bot "start after the container was killed"

echo "OK: pm-bot image check holds"
