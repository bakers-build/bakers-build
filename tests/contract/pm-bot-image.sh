#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Smoke test of the PM bot's image (pm-bot/Dockerfile).
#
#   bash tests/contract/pm-bot-image.sh [IMAGE]
#
# Without IMAGE it builds pm-bot/ as pm-bot:check first. The data directory
# is a Docker volume seeded as the Coder script leaves it (owned by uid 1000,
# .env mode 600), so the test runs the same against a local daemon and CI's
# Docker-in-Docker. It asserts:
#   - check mode: Hermes is the version the bot is written for, node is
#     present, config.yaml is rendered with no placeholder left and the
#     relay at its image path, pm-relay started as config.yaml says lists
#     its four tools, the skill's project reference is rendered
#   - SOUL.md and the project-manager skill in the data directory are the
#     image's (a hand edit to SOUL.md is restored); a learned skill and a
#     session are kept
#   - a missing required key stops the start and is named
#   - run mode, with the capabilities and options of the template's compose
#     file: the poller and exactly one gateway run, as hermes
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
  docker build -q -t "$IMAGE" pm-bot >/dev/null || fail "docker build pm-bot failed"
fi

volume="pm-bot-check-$$"
name="pm-bot-check-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1; docker volume rm -f "$volume" >/dev/null 2>&1' EXIT
docker volume create "$volume" >/dev/null

# In the data volume, as root of a throwaway container.
in_data() { docker run --rm -i -v "$volume:/d" --entrypoint sh "$IMAGE" -c "$1"; }

# What the Coder script and a running bot leave behind, and what must survive the next start.
in_data "umask 077; cat >/d/.env; mkdir -p /d/skills/learned /d/sessions
  echo kept >/d/skills/learned/SKILL.md; echo kept >/d/sessions/one.json; echo 'hand edit' >/d/SOUL.md
  chown -R $OWNER:$OWNER /d" <pm-bot/test/fixture.env

# The compose file's hardening, as docker run options.
caps=(--cap-drop ALL)
while read -r cap; do caps+=(--cap-add "$cap"); done < <(sed -n 's/^ *- \([A-Z_]*\) *# cap$/\1/p' "$COMPOSE")
[ ${#caps[@]} -gt 2 ] || fail "no capability list in $COMPOSE"
start() {
  docker run --env-file pm-bot/test/fixture.env -e HERMES_UID=$OWNER -e HERMES_GID=$OWNER \
    -v "$volume:/opt/data" "${caps[@]}" --security-opt no-new-privileges:true "$@"
}

out="$(start --rm "$IMAGE" check 2>&1)" || { echo "$out" >&2; fail "check mode failed"; }
grep -q "Hermes Agent $HERMES_VERSION " <<<"$out" || { echo "$out" >&2; fail "Hermes is not $HERMES_VERSION"; }
pass "Hermes $HERMES_VERSION"
grep -qE '^node v[0-9]+\.' <<<"$out" || { echo "$out" >&2; fail "node is missing"; }
pass "node present"

config="$(in_data 'cat /d/config.yaml')" || fail "config.yaml was not rendered"
! grep -n '\${' <<<"$config" || fail "config.yaml keeps a placeholder"
grep -q 'C0000000001,C0000000002' <<<"$config" || fail "config.yaml lacks the allowed channels"
grep -q '/opt/pm-bot/relay/server.mjs' <<<"$config" || fail "pm-relay is not the image's relay"
pass "config.yaml rendered, no placeholder left"

grep -qx 'pm-relay tools: answer_question,create_ticket,ticket_read,ticket_search' <<<"$out" \
  || { echo "$out" >&2; fail "pm-relay does not start from its configured command line"; }
pass "pm-relay starts as configured and lists its four tools"

ref=/d/skills/project-manager/references
in_data "[ ! -e $ref/project.template.md ] && grep -q https://bakers.example.com $ref/project.md" \
  || fail "the skill's project reference was not rendered"
in_data 'cat /d/skills/project-manager/SKILL.md' | cmp -s - pm-bot/skills/project-manager/SKILL.md \
  || fail "the project-manager skill is not the image's"
in_data 'cat /d/SOUL.md' | cmp -s - pm-bot/SOUL.md || fail "SOUL.md is not the image's (hand edit kept?)"
pass "SOUL.md and the project-manager skill are the image's"

[ "$(in_data 'cat /d/skills/learned/SKILL.md /d/sessions/one.json')" = "kept
kept" ] || fail "a learned skill or a session was lost"
pass "learned skills and sessions kept"

out="$(start --rm -e PM_BOT_PROJECT= -e SLACK_ADMIN_USERS= "$IMAGE" check 2>&1)" && fail "check passed without PM_BOT_PROJECT"
grep -q 'missing: SLACK_ADMIN_USERS PM_BOT_PROJECT' <<<"$out" || { echo "$out" >&2; fail "the missing keys are not named"; }
pass "a missing key stops the start and is named"

start -d --name "$name" "$IMAGE" >/dev/null || fail "the image does not start"
procs=""
for _ in $(seq 1 30); do
  sleep 2
  [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || break
  procs="$(docker exec "$name" ps -eo user=,args= 2>/dev/null)" || continue
  grep -q 'poller.mjs' <<<"$procs" && grep -qE 'gateway run$' <<<"$procs" && break
done
grep -qE '^hermes .*node /opt/pm-bot/poller/poller.mjs' <<<"$procs" \
  || { docker logs "$name" 2>&1 | tail -30 >&2; fail "the poller does not run as hermes"; }
grep -qE '^hermes .*gateway run$' <<<"$procs" || { docker logs "$name" 2>&1 | tail -30 >&2; fail "the gateway does not run as hermes"; }
sleep 5
gateways="$(docker exec "$name" ps -eo args= | grep -cE 'hermes_cli.main.*gateway' || true)"
[ "$gateways" = 1 ] || { docker exec "$name" ps -eo user=,args= >&2; fail "$gateways gateways run, not one"; }
[ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || fail "the container stopped"
pass "one container runs the poller and exactly one gateway, as hermes"

echo "OK: pm-bot image check holds"
