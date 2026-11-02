#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Behaviour of the PM bot's operator scripts (pm-bot/bin/), on a copy of
# pm-bot/ in a scratch directory with a stub `hermes`; nothing real starts.
#
#   bash tests/contract/pm-bot-scripts.sh
#
# Asserts:
#   - bin/clone leaves no secret file in the clone and refuses a clone URL
#     that carries credentials
#   - bin/setup accepts only the pinned Hermes version and commit, and stops
#     on an env value that could change the rendered YAML
#   - bin/setup installs the pm-relay server with its bakers.build client, the
#     installed relay starts and lists its tools, and bin/setup names every
#     missing required value
#   - bin/start serves every user (GATEWAY_ALLOW_ALL_USERS=true) unless
#     SLACK_ALLOWED_USERS names some
#   - bin/start fails without hermes on PATH and starts nothing
#   - bin/start logs to $HERMES_HOME/logs, or to PM_BOT_GATEWAY_LOG and
#     PM_BOT_POLLER_LOG, readable only by its user
#   - bin/clone takes its values from the environment without an env file
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test \
  GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test

BOT="$SCRATCH/pm-bot"
cp -R "$ROOT/pm-bot" "$BOT"
rm -f "$BOT/.env"

# A stub hermes that prints the version line it is given.
STUB="$SCRATCH/stub"
mkdir -p "$STUB"
stub_version() {
  printf '#!/bin/sh\necho "%s"\n' "$1" > "$STUB/hermes"
  chmod +x "$STUB/hermes"
}
PINNED_LINE='Hermes Agent v0.22.5 (2026.9.24) · stable · local bf0203a794a0'

# A complete env; each case overrides one value.
write_env() {
  cat > "$BOT/.env" <<EOF
HERMES_HOME=$SCRATCH/home
PM_BOT_MODEL=claude-sonnet-5-5
PM_BOT_TICKET_WORKFLOW=bb_autopilot
SLACK_ALLOWED_USERS=
SLACK_ALLOWED_CHANNELS=C0000000001
SLACK_ADMIN_USERS=U0000000009
SLACK_WORKSPACE_URL=https://example.slack.com
BAKERS_URL=https://bakers.example.test
BAKERS_CLIENT_ID=bakers-key-test
BAKERS_CLIENT_SECRET=secret
PM_BOT_PROJECT=00000000-0000-4000-8000-000000000000
PM_BOT_REPO_URL=$SCRATCH/customer
PM_BOT_CLONE_DIR=$SCRATCH/clone
EOF
  printf '%s\n' "$@" >> "$BOT/.env"
}

# --- bin/clone ---------------------------------------------------------------
REPO="$SCRATCH/customer"
mkdir -p "$REPO/web/sites/default" "$REPO/web/modules/custom/prices" "$REPO/.ddev" "$REPO/certs"
echo '<?php // code' > "$REPO/web/modules/custom/prices/prices.module"
for f in .env .env.local .ddev/.env web/sites/default/settings.php web/sites/default/settings.local.php \
         web/sites/services.local.yml auth.json .npmrc certs/site.pem certs/site.key; do
  echo secret > "$REPO/$f"
done
git -C "$REPO" init --quiet
git -C "$REPO" add -A
git -C "$REPO" commit --quiet -m fixture

write_env
"$BOT/bin/clone" >/dev/null || fail "bin/clone failed on a plain repository"
[ -f "$SCRATCH/clone/web/modules/custom/prices/prices.module" ] || fail "bin/clone left out the code"
left="$(cd "$SCRATCH/clone" && find . -path ./.git -prune -o -type f -print | grep -v prices.module || true)"
[ -z "$left" ] || fail "bin/clone left secret files in the clone: $left"
pass "bin/clone keeps the code and leaves every secret file out"

for url in https://bot:glpat-secret@git.example.test/customer.git HTTPS://glpat-secret@git.example.test/customer.git; do
  rm -rf "$SCRATCH/clone"
  write_env "PM_BOT_REPO_URL=$url"
  if out="$("$BOT/bin/clone" 2>&1)"; then fail "bin/clone accepted a clone URL with credentials: ${url%%:*}"; fi
  grep -q "carries credentials" <<<"$out" || fail "bin/clone did not refuse a ${url%%:*} URL for its credentials: $out"
  [ ! -e "$SCRATCH/clone" ] || fail "bin/clone cloned from a URL with credentials: ${url%%:*}"
done
pass "bin/clone refuses a clone URL that carries credentials, whatever the scheme's case"

# --- bin/setup ---------------------------------------------------------------
write_env
stub_version "$PINNED_LINE"
PATH="$STUB:$PATH" "$BOT/bin/setup" >/dev/null || fail "bin/setup refused the pinned Hermes"
[ -f "$SCRATCH/home/config.yaml" ] || fail "bin/setup rendered no config.yaml"
pass "bin/setup accepts the pinned Hermes"

cmp -s "$BOT/relay/server.mjs" "$SCRATCH/home/pm-relay/server.mjs" || fail "bin/setup did not install the pm-relay server"
cmp -s "$BOT/lib/bakers-client.mjs" "$SCRATCH/home/lib/bakers-client.mjs" || fail "bin/setup did not install the bakers.build client"
tools="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node "$SCRATCH/home/pm-relay/server.mjs" \
  | node -e 'let s="";process.stdin.on("data",(c)=>s+=c).on("end",()=>console.log(JSON.parse(s).result.tools.map((t)=>t.name).sort().join(",")))')"
[ "$tools" = "answer_question,create_ticket,ticket_read,ticket_search" ] || fail "the installed pm-relay lists $tools"
pass "bin/setup installs the pm-relay server and its client; the installed relay lists its four tools"

for key in BAKERS_URL BAKERS_CLIENT_ID BAKERS_CLIENT_SECRET PM_BOT_PROJECT PM_BOT_TICKET_WORKFLOW SLACK_ALLOWED_CHANNELS; do
  write_env "$key="
  if out="$(PATH="$STUB:$PATH" "$BOT/bin/setup" 2>&1)"; then fail "bin/setup accepted an empty $key"; fi
  grep -q "$key" <<<"$out" || fail "bin/setup did not name $key: $out"
done
pass "bin/setup names every missing required value"

stub_version 'Hermes Agent v0.22.50 (2026.9.24) · stable · local bf0203a794a0'
if PATH="$STUB:$PATH" "$BOT/bin/setup" >/dev/null 2>&1; then fail "bin/setup accepted v0.22.50"; fi
stub_version 'Hermes Agent v0.22.5 (2026.9.24) · stable · local 0123456789ab'
if PATH="$STUB:$PATH" "$BOT/bin/setup" >/dev/null 2>&1; then fail "bin/setup accepted another commit"; fi
pass "bin/setup refuses another Hermes version or commit"

stub_version "$PINNED_LINE"
for bad in "PM_BOT_MODEL='claude
agent: {}'" "PM_BOT_MODEL='claude #x'" "SLACK_ADMIN_USERS='U1: x'"; do
  write_env "$bad"
  if out="$(PATH="$STUB:$PATH" "$BOT/bin/setup" 2>&1)"; then fail "bin/setup rendered the unsafe value $bad"; fi
  var="${bad%%=*}"
  grep -q "$var" <<<"$out" || fail "bin/setup did not name $var: $out"
done
pass "bin/setup stops on a value that could change the YAML, naming it"

# --- bin/start ---------------------------------------------------------------
write_env
NOHERMES="$SCRATCH/nohermes"
mkdir -p "$NOHERMES"
ln -s "$(command -v node)" "$NOHERMES/node"
for tool in dirname cat kill nohup mkdir; do ln -sf "$(command -v "$tool")" "$NOHERMES/$tool"; done
rm -f "$SCRATCH/home/pm-bot-gateway.pid" "$SCRATCH/home/pm-bot-poller.pid"
if PATH="$NOHERMES" /bin/bash "$BOT/bin/start" >/dev/null 2>&1; then fail "bin/start succeeded without hermes"; fi
[ ! -e "$SCRATCH/home/pm-bot-gateway.pid" ] || fail "bin/start wrote a gateway pid without hermes"
[ ! -e "$SCRATCH/home/pm-bot-poller.pid" ] || fail "bin/start started the poller without hermes"
pass "bin/start fails without hermes and starts nothing"

# A stub hermes and node that stay running like the gateway and the poller.
RUNNING="$SCRATCH/running"
mkdir -p "$RUNNING"
printf '#!/bin/sh\necho started; echo "allow_all=${GATEWAY_ALLOW_ALL_USERS:-}"; exec sleep 30\n' > "$RUNNING/hermes"
printf '#!/bin/sh\necho started; exec sleep 30\n' > "$RUNNING/node"
chmod +x "$RUNNING/hermes" "$RUNNING/node"
start_and_stop() {
  PATH="$RUNNING:$PATH" "$BOT/bin/start" >/dev/null || fail "bin/start failed with hermes and node"
  sleep 1
  "$BOT/bin/stop" >/dev/null
}

write_env
start_and_stop
for name in gateway poller; do
  log="$SCRATCH/home/logs/pm-bot-$name.log"
  grep -q started "$log" 2>/dev/null || fail "bin/start wrote no $name log to $log"
done
pass "bin/start logs to \$HERMES_HOME/logs by default"

grep -qx 'allow_all=true' "$SCRATCH/home/logs/pm-bot-gateway.log" || fail "bin/start did not serve every user with an empty SLACK_ALLOWED_USERS"
write_env "SLACK_ALLOWED_USERS=U0000000001"
start_and_stop
grep -qx 'allow_all=' "$SCRATCH/home/logs/pm-bot-gateway.log" || fail "bin/start served every user although SLACK_ALLOWED_USERS is set"
pass "bin/start serves every user unless SLACK_ALLOWED_USERS names some"

write_env "PM_BOT_GATEWAY_LOG=$SCRATCH/tmp/gateway.log" "PM_BOT_POLLER_LOG=$SCRATCH/tmp/poller.log"
mkdir -p "$SCRATCH/tmp"
start_and_stop
for log in "$SCRATCH/tmp/gateway.log" "$SCRATCH/tmp/poller.log"; do
  grep -q started "$log" 2>/dev/null || fail "bin/start did not log to $log"
  mode="$(stat -c %a "$log" 2>/dev/null || stat -f %Lp "$log")"
  [ "$mode" = 600 ] || fail "$log is mode $mode, not 600"
done
pass "bin/start logs to PM_BOT_GATEWAY_LOG and PM_BOT_POLLER_LOG, readable only by its user"

# Pid files outlive a restart ($HERMES_HOME is on a volume in a workspace); their pid may
# then belong to another process of the same user.
write_env
sleep 30 &
other=$!
echo "$other" > "$SCRATCH/home/pm-bot-gateway.pid"
echo "$other" > "$SCRATCH/home/pm-bot-poller.pid"
out="$(PATH="$RUNNING:$PATH" "$BOT/bin/start")" || fail "bin/start failed with stale pid files"
sleep 1
"$BOT/bin/stop" >/dev/null
kill "$other" 2>/dev/null || true
for name in gateway poller; do
  grep -q "$name started" <<<"$out" || fail "bin/start took another process for the $name: $out"
done
pass "bin/start starts gateway and poller when their pid files name another process"

write_env
sleep 30 &
other=$!
echo "$other" > "$SCRATCH/home/pm-bot-gateway.pid"
echo "$other" > "$SCRATCH/home/pm-bot-poller.pid"
"$BOT/bin/stop" >/dev/null
alive=no; kill -0 "$other" 2>/dev/null && alive=yes
kill "$other" 2>/dev/null || true
[ "$alive" = yes ] || fail "bin/stop killed another process its stale pid files named"
[ ! -e "$SCRATCH/home/pm-bot-gateway.pid" ] || fail "bin/stop kept a stale gateway pid file"
pass "bin/stop leaves another process alive when its pid files name it"

# --- bin/clone without a readable env file ------------------------------------
# In a workspace another user than the bot refreshes the clone and cannot read
# the bot's env file; the clone's two values come from the environment instead.
rm -f "$BOT/.env"
rm -rf "$SCRATCH/clone"
PM_BOT_REPO_URL="$SCRATCH/customer" PM_BOT_CLONE_DIR="$SCRATCH/clone" "$BOT/bin/clone" >/dev/null \
  || fail "bin/clone failed with its values in the environment and no env file"
[ -f "$SCRATCH/clone/web/modules/custom/prices/prices.module" ] || fail "bin/clone without env file left out the code"
pass "bin/clone takes its values from the environment when there is no env file"

echo "OK: pm-bot scripts behave"
